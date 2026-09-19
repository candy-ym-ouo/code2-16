// 复现性：同一随机种子必须复现同一态势
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSimulation } from '../src/engine.js';
import { normalizeConfig } from '../src/config.js';
import { canonicalJson, contentHash } from '../src/canon.js';
import { WindField } from '../src/weather.js';
import { spawnStreams } from '../src/rng.js';

test('同一随机种子复现同一态势（逐字节一致）', () => {
  const cfg = normalizeConfig({ seed: 42, days: 5 });
  const first = runSimulation(cfg);
  const second = runSimulation(cfg);
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(contentHash(first), contentHash(second));
});

test('不同种子产生不同态势', () => {
  const a = runSimulation(normalizeConfig({ seed: 1, days: 3 }));
  const b = runSimulation(normalizeConfig({ seed: 2, days: 3 }));
  assert.notEqual(contentHash(a), contentHash(b));
});

test('风场按种子确定且日际自相关显著为正', () => {
  const cfg = normalizeConfig({ seed: 7, days: 30 });
  const w1 = new WindField(cfg.weather, spawnStreams(cfg.seed).weather, 30);
  const w2 = new WindField(cfg.weather, spawnStreams(cfg.seed).weather, 30);
  assert.deepEqual(w1.sample(10, 30, 110), w2.sample(10, 30, 110));

  const series = [];
  for (let d = 0; d < 30; d++) series.push(w1.sample(d, 35, 115).u);
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const centered = series.map((x) => x - mean);
  const denom = centered.reduce((acc, x) => acc + x * x, 0);
  const numer = centered.slice(0, -1).reduce((acc, x, i) => acc + x * centered[i + 1], 0);
  const lag1 = numer / denom;
  assert.ok(lag1 > 0.3, `风场日际滞后一阶相关系数应显著为正，实际 ${lag1.toFixed(3)}`);
});
