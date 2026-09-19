// 延误传播仿真：按班表时间顺序推进，每架信使艇维护"所在岛屿 + 可用时刻"状态。
// 延误来源四分：天气（地面停飞/强风/复飞等待）、轮转传播（前段晚到）、
// 地面保障噪声、航路顶风。取消会引发运力错位级联（后续航段无机可用）。

import crypto from 'node:crypto';
import { clamp, createStreamRng, round } from './rng.js';
import {
  ALL_ISLANDS,
  TURNAROUND_HOURS,
  bearingBetween,
  compareLegs,
  generateSchedule
} from './schedule.js';
import { generateWeatherField, windAt } from './weather.js';

export const MAX_GROUND_HOLD_HOURS = 6; // 地面停飞等待上限，超过则取消
export const GALE_SOFT_DELAY_HOURS = 0.5; // 强风软性延误
export const DEST_STORM_HOLD_HOURS = 0.75; // 目的地烈风复飞等待

function windBoost(wind, bearing) {
  // 与 engine.js calculateRoute 相同的风速修正系数
  return wind.strength * Math.cos(((bearing - wind.angle) * Math.PI) / 180) * 0.78;
}

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digestOf(value) {
  return crypto.createHash('sha256').update(canonicalize(value)).digest('hex');
}

function cancelEvent(leg, reason) {
  return {
    id: leg.id,
    day: leg.day,
    courierId: leg.courierId,
    originId: leg.originId,
    destId: leg.destId,
    status: 'cancelled',
    cancelReason: reason,
    schedDepHour: leg.schedDepHour
  };
}

export function simulate({ seed, days, schedule, weather, islands = ALL_ISLANDS }) {
  const islandById = new Map(islands.map((island) => [island.id, island]));
  const rngOps = createStreamRng(seed, 'ops');
  const courierState = new Map();
  const events = [];
  const legs = [...schedule.legs].sort(compareLegs);

  for (const leg of legs) {
    let state = courierState.get(leg.courierId);
    if (!state) {
      state = { islandId: leg.originId, availableHour: 0 };
      courierState.set(leg.courierId, state);
    }

    // 前序取消导致运力不在始发岛：级联取消
    if (state.islandId !== leg.originId) {
      events.push(cancelEvent(leg, 'aircraft-out-of-position'));
      continue;
    }

    const earliest = Math.max(leg.schedDepHour, state.availableHour);
    const rotationDelay = Math.max(0, earliest - leg.schedDepHour);
    let dep = earliest;
    let weatherDelay = 0;

    // 烈风地面停飞：逐小时等待，超过上限或触及宵禁则取消
    let holds = 0;
    let cancelled = null;
    while (windAt(weather, leg.originId, dep).storm) {
      dep = Math.floor(dep) + 1;
      holds += 1;
      if (holds >= MAX_GROUND_HOLD_HOURS || dep >= leg.day * 24 - 1) {
        cancelled = 'weather-ground-stop';
        break;
      }
    }
    if (cancelled) {
      events.push(cancelEvent(leg, cancelled));
      state.availableHour = dep + 1; // 运力留在原地，待天气好转
      continue;
    }
    weatherDelay += dep - earliest;

    // 强风软性延误
    if (windAt(weather, leg.originId, dep).gale) {
      dep += GALE_SOFT_DELAY_HOURS;
      weatherDelay += GALE_SOFT_DELAY_HOURS;
    }

    // 地面保障噪声（装货、放行）
    const handling = rngOps() * 0.25;
    dep += handling;

    // 航路顶风/顺风：取起飞机场与目的地机场风况的均值
    const origin = islandById.get(leg.originId);
    const dest = islandById.get(leg.destId);
    const bearing = bearingBetween(origin, dest);
    const boost = 0.5 * (
      windBoost(windAt(weather, leg.originId, dep), bearing) +
      windBoost(windAt(weather, leg.destId, dep + leg.baseHours), bearing)
    );
    const speed = clamp(leg.baseSpeed + boost, 24, 118);
    const enroute = leg.distanceKm / speed;
    let arr = dep + enroute;
    let enrouteDelay = enroute - leg.baseHours;

    // 目的地烈风：复飞等待
    if (windAt(weather, leg.destId, arr).storm) {
      arr += DEST_STORM_HOLD_HOURS;
      enrouteDelay += DEST_STORM_HOLD_HOURS;
    }

    state.islandId = leg.destId;
    state.availableHour = arr + TURNAROUND_HOURS;

    events.push({
      id: leg.id,
      day: leg.day,
      courierId: leg.courierId,
      originId: leg.originId,
      destId: leg.destId,
      status: 'operated',
      schedDepHour: leg.schedDepHour,
      depHour: round(dep, 3),
      arrHour: round(arr, 3),
      depDelayMin: round((dep - leg.schedDepHour) * 60, 1),
      rotationDelayMin: round(rotationDelay * 60, 1),
      weatherDelayMin: round(weatherDelay * 60, 1),
      handlingDelayMin: round(handling * 60, 1),
      enrouteDelayMin: round(enrouteDelay * 60, 1),
      effectiveSpeed: round(speed, 1)
    });
  }

  return { events, summary: summarize(events, days) };
}

function summarizeSlice(day, events) {
  const operated = events.filter((event) => event.status === 'operated');
  const cancelled = events.filter((event) => event.status === 'cancelled');
  const delays = operated.map((event) => event.depDelayMin).sort((first, second) => first - second);
  const sum = (key) => round(operated.reduce((total, event) => total + Math.max(0, event[key]), 0), 1);
  const weather = sum('weatherDelayMin');
  const rotation = sum('rotationDelayMin');
  const handling = sum('handlingDelayMin');
  const enroute = sum('enrouteDelayMin');
  const total = round(weather + rotation + handling + enroute, 1);
  const cancelReasons = {};
  for (const event of cancelled) {
    cancelReasons[event.cancelReason] = (cancelReasons[event.cancelReason] || 0) + 1;
  }

  return {
    day, // 0 表示全程合计
    legs: events.length,
    operated: operated.length,
    cancelled: cancelled.length,
    cancelReasons,
    avgDepDelayMin: delays.length ? round(delays.reduce((a, b) => a + b, 0) / delays.length, 1) : 0,
    p95DepDelayMin: delays.length ? delays[Math.min(delays.length - 1, Math.floor(delays.length * 0.95))] : 0,
    weatherDelayMin: weather,
    rotationDelayMin: rotation,
    handlingDelayMin: handling,
    enrouteDelayMin: enroute,
    totalDelayMin: total,
    propagatedShare: total > 0 ? round(rotation / total, 3) : 0
  };
}

export function summarize(events, days) {
  const byDay = [];
  for (let day = 1; day <= days; day += 1) {
    byDay.push(summarizeSlice(day, events.filter((event) => event.day === day)));
  }
  return { days: byDay, total: summarizeSlice(0, events) };
}

// 一键构建完整态势：班表 + 天气场 + 延误事件 + 摘要 + 态势摘要（SHA-256）。
export function runSandbox({ seed, days = 5 } = {}) {
  const normalizedSeed = String(seed ?? 'sandbox');
  const schedule = generateSchedule(normalizedSeed, days);
  const weather = generateWeatherField(normalizedSeed, days, ALL_ISLANDS);
  const { events, summary } = simulate({ seed: normalizedSeed, days, schedule, weather });
  const digest = digestOf({
    seed: normalizedSeed,
    days,
    legs: schedule.legs,
    hours: weather.hours,
    events
  });
  return { seed: normalizedSeed, days, schedule, weather, events, summary, digest };
}
