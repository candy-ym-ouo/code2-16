// 延误传播引擎：按计划出港时刻顺序推进事件。
// 延误来源分解：
//   一次延误  = 机械故障 + 机场流控 + 大风地面等待（computePrimaryHolds 预生成）
//   传播延误  = 同机前段晚到导致过站不足（propagatedMin）
//   风况延误  = 顶风/顺风改变空中飞行时间（windMin）
//   容量延误  = 目的地机场 30 分钟到达桶超限排队（congestionMin）
import { spawnStreams } from './rng.js';
import { buildSchedule, airportByCode } from './network.js';
import { WindField } from './weather.js';
import { summarize } from './metrics.js';
import { normalizeConfig } from './config.js';

// 航路顶风分量（m/s，正=顶风）：沿航迹取 3 个采样点投影平均
export function headwindMs(wind, day, origin, dest) {
  const o = airportByCode.get(origin);
  const d = airportByCode.get(dest);
  const meanLat = ((o.lat + d.lat) / 2) * (Math.PI / 180);
  const east = (d.lon - o.lon) * Math.cos(meanLat);
  const north = d.lat - o.lat;
  const norm = Math.hypot(east, north) || 1;
  let head = 0;
  for (const t of [0.25, 0.5, 0.75]) {
    const w = wind.sample(day, o.lat + (d.lat - o.lat) * t, o.lon + (d.lon - o.lon) * t);
    head += -(w.u * (east / norm) + w.v * (north / norm));
  }
  return head / 3;
}

// 预生成每班的一次性延误（机械 / 流控 / 大风地面等待），消耗 ops 随机流
export function computePrimaryHolds(cfg, flights, rng, wind) {
  const holds = new Map(flights.map((f) => [f.fid, { mechMin: 0, flowMin: 0, weatherHoldMin: 0 }]));
  // 机械故障：逐班判定
  for (const f of flights) {
    if (rng.chance(cfg.ops.mechProb)) {
      holds.get(f.fid).mechMin = rng.exponential(cfg.ops.mechMeanMin);
    }
  }
  // 机场流控：按 机场×日 生成 2 小时流控窗口，窗口内出港航班统一附加延误
  for (const ap of airportByCode.values()) {
    for (let day = 0; day < cfg.days; day++) {
      if (!rng.chance(cfg.ops.flowProb)) continue;
      const startHour = rng.uniform(7, 18);
      const extraMin = rng.uniform(5, 25);
      for (const f of flights) {
        if (f.origin !== ap.code || f.day !== day) continue;
        const hour = (f.schedDep % 1440) / 60;
        if (hour >= startHour && hour < startHour + 2) holds.get(f.fid).flowMin += extraMin;
      }
    }
  }
  // 大风地面等待：出港时刻地面风超标，按超出量线性折算（封顶 90 分钟）
  for (const f of flights) {
    const ap = airportByCode.get(f.origin);
    const hour = (f.schedDep % 1440) / 60;
    const surface = wind.surfaceAt(f.day, ap.lat, ap.lon, hour);
    if (surface > cfg.weather.gustLimitMs) {
      holds.get(f.fid).weatherHoldMin = Math.min(90, (surface - cfg.weather.gustLimitMs) * 6);
    }
  }
  return holds;
}

// 事件推进主循环。flights 内同机前段的 schedDep 必然更早，排序后前段必先被处理。
export function propagate(cfg, flights, holds, wind) {
  const actualByFid = new Map(); // fid -> { arr }（取消航班按调机假设记 schedArr）
  const arrivalBuckets = new Map(); // 机场|日|30分钟桶 -> 已到达架次
  const records = [];
  const sorted = [...flights].sort((a, b) => a.schedDep - b.schedDep || (a.fid < b.fid ? -1 : 1));
  for (const f of sorted) {
    const hold = holds.get(f.fid);
    const prev = f.prevFid ? actualByFid.get(f.prevFid) : null;
    const ready = prev ? prev.arr + cfg.turnaroundMin : -Infinity;
    const propagatedMin = Math.max(0, ready - f.schedDep);
    const primaryMin = hold.mechMin + hold.flowMin + hold.weatherHoldMin;
    const dep = Math.max(f.schedDep, ready) + primaryMin;
    const depDelay = dep - f.schedDep;
    if (depDelay > cfg.cancelThresholdMin) {
      // 取消假设：调机按原计划时刻恢复，下一航段可从 schedArr + 过站 继续
      actualByFid.set(f.fid, { arr: f.schedArr });
      records.push({
        ...f,
        dep: null,
        arr: null,
        canceled: true,
        depDelay,
        arrDelay: null,
        propagatedMin,
        mechMin: hold.mechMin,
        flowMin: hold.flowMin,
        weatherHoldMin: hold.weatherHoldMin,
        windMin: 0,
        congestionMin: 0,
      });
      continue;
    }
    const head = headwindMs(wind, f.day, f.origin, f.dest);
    const speedKmh = Math.max(400, cfg.cruiseKmh - head * 3.6);
    const blockMin = (f.distanceKm / speedKmh) * 60 + cfg.taxiMin;
    const windMin = blockMin - f.baseBlockMin;
    let arr = dep + blockMin;
    // 目的地机场到达容量：30 分钟桶排队
    const dest = airportByCode.get(f.dest);
    const bucketKey = `${f.dest}|${Math.floor(arr / 1440)}|${Math.floor((arr % 1440) / 30)}`;
    const queued = arrivalBuckets.get(bucketKey) || 0;
    const congestionMin = Math.max(0, queued - (dest.cap - 1)) * 2.5;
    arr += congestionMin;
    arrivalBuckets.set(bucketKey, queued + 1);
    actualByFid.set(f.fid, { arr });
    records.push({
      ...f,
      dep,
      arr,
      canceled: false,
      depDelay,
      arrDelay: arr - f.schedArr,
      propagatedMin,
      mechMin: hold.mechMin,
      flowMin: hold.flowMin,
      weatherHoldMin: hold.weatherHoldMin,
      windMin,
      congestionMin,
    });
  }
  return records;
}

// 顶层编排：配置（含种子）→ 完整态势。全过程确定性，可逐字节复现。
export function runSimulation(config) {
  const cfg = normalizeConfig(config);
  const streams = spawnStreams(cfg.seed);
  const flights = buildSchedule(cfg, streams.schedule);
  const wind = new WindField(cfg.weather, streams.weather, cfg.days);
  const holds = computePrimaryHolds(cfg, flights, streams.ops, wind);
  const records = propagate(cfg, flights, holds, wind);
  const { daily, totals } = summarize(records, cfg.days);
  return { config: cfg, flights: records, daily, totals };
}
