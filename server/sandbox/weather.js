// 多日逐小时风况场：区域共同因子（大风过程）+ 各岛 AR(1) 风速 + 风向随机游走。
// 全部随机性来自种子派生的单一随机流，按固定顺序消耗，因此天气场是种子的纯函数。

import { clamp, createStreamRng, randomNormal, round } from './rng.js';

export const COMPASS_8 = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
export const GALE_GUST_LIMIT = 17; // 强风（阵风 m/s 换算）：软性延误
export const STORM_GUST_LIMIT = 24; // 烈风：地面停飞 / 复飞等待

const MEAN_REVERSION = 0.28; // AR(1) 均值回归系数
const LOCAL_SIGMA = 1.05; // 局地扰动强度
const REGIONAL_DECAY = 0.9; // 区域因子惯性

export function generateWeatherField(seed, days, islands) {
  const rng = createStreamRng(seed, 'weather');
  const totalHours = days * 24;
  const sorted = [...islands].sort((first, second) => (first.id < second.id ? -1 : 1));
  const state = new Map(sorted.map((island) => [island.id, {
    strength: 5 + rng() * 5,
    directionIndex: Math.floor(rng() * COMPASS_8.length)
  }]));

  let regional = 0;
  const hours = [];
  for (let hour = 0; hour < totalHours; hour += 1) {
    // 区域共同因子：模拟跨岛的大风过程，让各岛风况同涨同落
    regional = REGIONAL_DECAY * regional + randomNormal(rng) * 1.1;
    const diurnal = 2.4 * Math.sin((((hour % 24) - 6) / 24) * 2 * Math.PI); // 午后风强
    const entry = {
      hour,
      day: Math.floor(hour / 24) + 1,
      hourOfDay: hour % 24,
      islands: {}
    };

    for (const island of sorted) {
      const local = state.get(island.id);
      const mean = 6.5 + regional * 1.6 + diurnal;
      local.strength = clamp(
        local.strength + MEAN_REVERSION * (mean - local.strength) + randomNormal(rng) * LOCAL_SIGMA,
        1.2,
        30
      );
      if (rng() < 0.3) {
        local.directionIndex = (local.directionIndex + (rng() < 0.5 ? 1 : COMPASS_8.length - 1)) % COMPASS_8.length;
      }
      const gust = round(local.strength * (1.15 + 0.45 * rng()), 1);
      entry.islands[island.id] = {
        strength: round(local.strength, 2),
        gust,
        directionIndex: local.directionIndex,
        direction: COMPASS_8[local.directionIndex],
        angle: -90 + local.directionIndex * 45, // 与 engine.js 的风向角约定一致
        gale: gust >= GALE_GUST_LIMIT,
        storm: gust >= STORM_GUST_LIMIT
      };
    }
    hours.push(entry);
  }

  return { seed: String(seed), days, hours };
}

export function windAt(field, islandId, absoluteHour) {
  const index = clamp(Math.floor(absoluteHour), 0, field.hours.length - 1);
  return field.hours[index].islands[islandId];
}
