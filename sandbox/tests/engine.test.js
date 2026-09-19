// 引擎行为：延误生成与传播的正确性
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSimulation, propagate } from '../src/engine.js';
import { normalizeConfig } from '../src/config.js';
import { spawnStreams } from '../src/rng.js';
import { buildSchedule } from '../src/network.js';
import { WindField } from '../src/weather.js';

// 构造无风无扰动的“静稳”对照组
function calmConfig(overrides = {}) {
  return normalizeConfig({
    seed: 5,
    days: 2,
    weather: { sigmaMs: 0, westerlyMs: 0 },
    ops: { mechProb: 0, flowProb: 0 },
    ...overrides,
  });
}

test('静稳天气且无运控扰动时：无传播延误、无取消、无风况影响', () => {
  const { totals } = runSimulation(calmConfig());
  assert.equal(totals.canceled, 0);
  assert.equal(totals.propagatedMin, 0);
  assert.equal(totals.primaryMin, 0);
  assert.ok(Math.abs(totals.windMin) < 1e-9, `静稳时不应有风况延误，实际 ${totals.windMin}`);
});

test('前段延误沿机尾衔接向下游传播', () => {
  const cfg = calmConfig({ days: 1, tails: 1, legsPerDay: 3 });
  const streams = spawnStreams(cfg.seed);
  const flights = buildSchedule(cfg, streams.schedule);
  const wind = new WindField(cfg.weather, streams.weather, cfg.days);
  const holds = new Map(flights.map((f) => [f.fid, { mechMin: 0, flowMin: 0, weatherHoldMin: 0 }]));
  holds.get(flights[0].fid).mechMin = 120; // 向首班注入 120 分钟故障

  const records = propagate(cfg, flights, holds, wind);
  const byFid = new Map(records.map((r) => [r.fid, r]));
  assert.equal(byFid.get(flights[0].fid).propagatedMin, 0, '首班无上游，传播延误应为 0');
  const second = byFid.get(flights[1].fid);
  assert.ok(second.propagatedMin > 0, `第二段应继承首班延误，实际 ${second.propagatedMin}`);
  assert.ok(second.arrDelay > 0, '第二段到港应晚点');
});

test('出港延误超过阈值判定取消，取消后机队按调机假设恢复', () => {
  const cfg = calmConfig({ days: 1, tails: 1, legsPerDay: 2 });
  const streams = spawnStreams(cfg.seed);
  const flights = buildSchedule(cfg, streams.schedule);
  const wind = new WindField(cfg.weather, streams.weather, cfg.days);
  const holds = new Map(flights.map((f) => [f.fid, { mechMin: 0, flowMin: 0, weatherHoldMin: 0 }]));
  holds.get(flights[0].fid).mechMin = cfg.cancelThresholdMin + 60;

  const records = propagate(cfg, flights, holds, wind);
  const byFid = new Map(records.map((r) => [r.fid, r]));
  assert.equal(byFid.get(flights[0].fid).canceled, true);
  assert.equal(byFid.get(flights[1].fid).propagatedMin, 0, '取消后按调机假设恢复，后续航段不应被拖晚');
});

test('强顶风显著拉长飞行时间并推高总延误', () => {
  const calm = runSimulation(calmConfig());
  const storm = runSimulation(
    calmConfig({ weather: { sigmaMs: 0, westerlyMs: 45 }, ops: { mechProb: 0, flowProb: 0 } }),
  );
  assert.ok(storm.totals.windMin > 0, '强西风下西向航段应产生顶风延误');
  assert.ok(
    storm.totals.avgArrDelay > calm.totals.avgArrDelay,
    `强风态势平均延误应高于静稳态势（${storm.totals.avgArrDelay} vs ${calm.totals.avgArrDelay}）`,
  );
});
