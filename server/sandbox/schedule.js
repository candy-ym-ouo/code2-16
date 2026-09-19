// 多日班表生成：每架信使艇每日多段轮转（rotation），过站 0.7 小时，
// 末班不晚于 21:00，过夜停留在当日最后到达的岛屿（次日从该岛继续轮转）。

import { COURIERS, HUB_ID, HUB_ISLAND, ISLANDS } from '../engine.js';
import { createStreamRng, round } from './rng.js';

export const ALL_ISLANDS = [HUB_ISLAND, ...ISLANDS];
export const TURNAROUND_HOURS = 0.7;

const DISTANCE_SCALE = 2.2; // 与 engine.js distanceBetween 的比例尺保持一致
const DAY_START_HOUR = 6.5;
const LAST_DEPARTURE_HOUR = 21;
const LEGS_PER_DAY = 4;

export function distanceBetween(first, second) {
  return Math.hypot(first.position.x - second.position.x, first.position.y - second.position.y) * DISTANCE_SCALE;
}

export function bearingBetween(first, second) {
  return Math.atan2(
    second.position.y - first.position.y,
    second.position.x - first.position.x
  ) * 180 / Math.PI;
}

export function compareLegs(first, second) {
  if (first.schedDepHour !== second.schedDepHour) return first.schedDepHour - second.schedDepHour;
  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
}

export function generateSchedule(seed, days, couriers = COURIERS, islands = ALL_ISLANDS) {
  const rng = createStreamRng(seed, 'schedule');
  const legs = [];
  const location = new Map(couriers.map((courier) => [courier.id, HUB_ID]));

  for (let day = 1; day <= days; day += 1) {
    const dayStart = (day - 1) * 24;
    for (const courier of couriers) {
      let hour = dayStart + DAY_START_HOUR + rng();
      for (let seq = 1; seq <= LEGS_PER_DAY; seq += 1) {
        const originId = location.get(courier.id);
        const origin = islands.find((island) => island.id === originId);
        const candidates = islands.filter((island) => island.id !== originId);
        // 回港偏好：枢纽港权重翻倍，模拟轮辐式网络
        const weights = candidates.map((island) => (island.id === HUB_ID ? 2 : 1));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let roll = rng() * totalWeight;
        let dest = candidates[candidates.length - 1];
        for (let index = 0; index < candidates.length; index += 1) {
          roll -= weights[index];
          if (roll <= 0) {
            dest = candidates[index];
            break;
          }
        }

        const distanceKm = round(distanceBetween(origin, dest), 1);
        const baseHours = round(distanceKm / courier.baseSpeed, 2);
        legs.push({
          id: `D${String(day).padStart(2, '0')}-${courier.callSign}-${seq}`,
          day,
          courierId: courier.id,
          callSign: courier.callSign,
          originId,
          destId: dest.id,
          schedDepHour: round(hour, 2),
          distanceKm,
          baseHours,
          baseSpeed: courier.baseSpeed
        });

        location.set(courier.id, dest.id);
        hour += baseHours + TURNAROUND_HOURS;
        if (hour > dayStart + LAST_DEPARTURE_HOUR) break;
      }
    }
  }

  legs.sort(compareLegs);
  return { seed: String(seed), days, legs };
}
