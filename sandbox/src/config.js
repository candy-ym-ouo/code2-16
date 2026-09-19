// 沙盘配置：所有影响态势的参数集中于此，配置 + 种子共同决定一次实验。
export const DEFAULT_CONFIG = {
  seed: 42, // 主随机种子：同一种子复现同一态势
  days: 7, // 模拟天数
  tails: 12, // 机队规模（机尾数）
  legsPerDay: 4, // 每机每日航段数
  turnaroundMin: 50, // 最小过站时间（分钟）
  cancelThresholdMin: 240, // 出港延误超过该值判定取消
  cruiseKmh: 850, // 巡航地速基准
  taxiMin: 30, // 滑行+起降固定耗时
  scheduleBuffer: 1.15, // 计划班期余量系数
  weather: {
    rho: 0.75, // 风场日际相关系数（AR(1)）
    sigmaMs: 6, // 高空风创新项标准差（m/s）
    westerlyMs: 10, // 盛行西风幅值（m/s，中纬度最大）
    surfaceFactor: 0.35, // 高空风折算地面风比例
    gustLimitMs: 17, // 地面风超过该值触发地面等待
  },
  ops: {
    mechProb: 0.05, // 单班机械故障概率
    mechMeanMin: 20, // 机械故障平均延误（分钟）
    flowProb: 0.2, // 机场-日 流控发生概率
  },
};

export function normalizeConfig(overrides = {}) {
  const cfg = {
    ...DEFAULT_CONFIG,
    ...overrides,
    weather: { ...DEFAULT_CONFIG.weather, ...(overrides.weather || {}) },
    ops: { ...DEFAULT_CONFIG.ops, ...(overrides.ops || {}) },
  };
  if (!Number.isInteger(cfg.seed) || cfg.seed < 0) throw new Error(`seed 必须是非负整数：${cfg.seed}`);
  if (!Number.isInteger(cfg.days) || cfg.days < 1) throw new Error(`days 必须是 ≥1 的整数：${cfg.days}`);
  if (!Number.isInteger(cfg.tails) || cfg.tails < 1) throw new Error(`tails 必须是 ≥1 的整数：${cfg.tails}`);
  if (!Number.isInteger(cfg.legsPerDay) || cfg.legsPerDay < 1) throw new Error(`legsPerDay 必须是 ≥1 的整数：${cfg.legsPerDay}`);
  if (cfg.weather.rho < 0 || cfg.weather.rho >= 1) throw new Error(`weather.rho 必须在 [0,1) 内：${cfg.weather.rho}`);
  return cfg;
}
