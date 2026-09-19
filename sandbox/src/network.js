// 航线网络与航班计划：机队-航段衔接（rotation）由 schedule 随机流确定性生成。
// 同一架飞机一天内飞多个航段，前段延误通过 prevFid 衔接关系向后传播。

export const AIRPORTS = [
  { code: 'PEK', name: '北京首都', lat: 40.08, lon: 116.58, cap: 12 },
  { code: 'SHA', name: '上海虹桥', lat: 31.2, lon: 121.34, cap: 11 },
  { code: 'CAN', name: '广州白云', lat: 23.39, lon: 113.3, cap: 10 },
  { code: 'SZX', name: '深圳宝安', lat: 22.64, lon: 113.81, cap: 9 },
  { code: 'CTU', name: '成都双流', lat: 30.58, lon: 103.95, cap: 8 },
  { code: 'XIY', name: '西安咸阳', lat: 34.45, lon: 108.75, cap: 7 },
  { code: 'KMG', name: '昆明长水', lat: 25.1, lon: 102.93, cap: 7 },
  { code: 'HGH', name: '杭州萧山', lat: 30.23, lon: 120.43, cap: 7 },
  { code: 'CKG', name: '重庆江北', lat: 29.72, lon: 106.64, cap: 7 },
  { code: 'WUH', name: '武汉天河', lat: 30.78, lon: 114.21, cap: 6 },
];

export const airportByCode = new Map(AIRPORTS.map((a) => [a.code, a]));

export function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// 生成整个模拟期的航班计划。时间单位：自第 0 日 00:00 起的分钟数。
export function buildSchedule(cfg, rng) {
  const flights = [];
  for (let t = 0; t < cfg.tails; t++) {
    const tail = `AC${String(t + 1).padStart(2, '0')}`;
    let current = rng.pick(AIRPORTS).code;
    let prevFid = null;
    for (let day = 0; day < cfg.days; day++) {
      let clock = day * 1440 + rng.uniform(360, 540); // 首班 06:00-09:00 出港
      for (let leg = 0; leg < cfg.legsPerDay; leg++) {
        let dest = rng.pick(AIRPORTS);
        while (dest.code === current) dest = rng.pick(AIRPORTS);
        const origin = airportByCode.get(current);
        const distanceKm = haversineKm(origin, dest);
        const baseBlockMin = (distanceKm / cfg.cruiseKmh) * 60 + cfg.taxiMin;
        const schedDep = clock;
        const schedArr = schedDep + baseBlockMin * cfg.scheduleBuffer;
        const fid = `${tail}-D${day + 1}-L${leg + 1}`;
        flights.push({
          fid,
          day,
          tail,
          origin: current,
          dest: dest.code,
          schedDep,
          schedArr,
          baseBlockMin,
          distanceKm,
          prevFid, // 同机前一航段：延误沿此链传播
        });
        prevFid = fid;
        current = dest.code;
        clock = schedArr + cfg.turnaroundMin + rng.uniform(0, 30);
      }
    }
  }
  return flights;
}
