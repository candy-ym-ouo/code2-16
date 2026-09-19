// 指标汇总：按日与全期统计延误构成（一次延误 / 传播延误 / 风况 / 容量）。
function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[idx];
}

function dayStats(day, list) {
  const arrived = list.filter((r) => !r.canceled);
  const delays = arrived.map((r) => r.arrDelay).sort((a, b) => a - b);
  const sum = (key) => list.reduce((acc, r) => acc + (r[key] || 0), 0);
  const canceled = list.length - arrived.length;
  return {
    ...(day === null ? {} : { day }),
    flights: list.length,
    canceled,
    cancelRate: list.length ? canceled / list.length : 0,
    avgArrDelay: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0,
    p95ArrDelay: percentile(delays, 95),
    maxArrDelay: delays.length ? delays[delays.length - 1] : 0,
    primaryMin: sum('mechMin') + sum('flowMin') + sum('weatherHoldMin'),
    mechMin: sum('mechMin'),
    flowMin: sum('flowMin'),
    weatherHoldMin: sum('weatherHoldMin'),
    propagatedMin: sum('propagatedMin'),
    windMin: sum('windMin'),
    congestionMin: sum('congestionMin'),
  };
}

export function summarize(records, days) {
  const daily = [];
  for (let d = 0; d < days; d++) {
    daily.push(dayStats(d, records.filter((r) => r.day === d)));
  }
  const totals = dayStats(null, records);
  // 传播系数：每 1 分钟一次延误平均放大出多少分钟下游延误
  totals.propagationRatio = totals.primaryMin > 0 ? totals.propagatedMin / totals.primaryMin : 0;
  return { daily, totals };
}
