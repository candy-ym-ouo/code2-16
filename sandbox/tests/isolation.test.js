// 隔离性：实验数据与正式存档物理隔离，晋升须复算验证
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExperimentStore, ArchiveStore, IsolationError } from '../src/storage.js';
import { runSimulation } from '../src/engine.js';
import { normalizeConfig } from '../src/config.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-test-'));
}

function makeStores() {
  const root = tempRoot();
  const experiments = new ExperimentStore(path.join(root, 'experiments'));
  const archive = new ArchiveStore(path.join(root, 'archive'), experiments);
  return { root, experiments, archive };
}

test('实验数据只写入实验区，正式存档保持为空', () => {
  const { root, experiments, archive } = makeStores();
  const config = normalizeConfig({ seed: 9, days: 3 });
  const results = runSimulation(config);
  experiments.saveRun('exp-alpha', config, results);

  assert.ok(fs.existsSync(path.join(root, 'experiments', 'exp-alpha', 'results.json')));
  assert.deepEqual(archive.list(), []);
  assert.deepEqual(fs.readdirSync(path.join(root, 'archive')), []);
});

test('正式存档禁止直接写入', () => {
  const { archive } = makeStores();
  assert.throws(() => archive.save({}), IsolationError);
});

test('promote 复算验证后晋升，且写一次不可覆盖', () => {
  const { root, experiments, archive } = makeStores();
  const config = normalizeConfig({ seed: 11, days: 3 });
  experiments.saveRun('exp-beta', config, runSimulation(config));

  const { verified } = archive.promote('exp-beta', { simulate: runSimulation });
  assert.equal(verified, true);
  const archiveDir = path.join(root, 'archive', 'exp-beta');
  for (const name of ['config.json', 'results.json', 'meta.json', 'PROMOTION.json']) {
    assert.ok(fs.existsSync(path.join(archiveDir, name)), `存档缺少 ${name}`);
  }
  assert.throws(() => archive.promote('exp-beta', { simulate: runSimulation }), IsolationError);
});

test('篡改实验数据无法通过晋升校验', () => {
  const { experiments, archive } = makeStores();
  const config = normalizeConfig({ seed: 13, days: 2 });
  experiments.saveRun('exp-gamma', config, runSimulation(config));

  const resultsPath = path.join(experiments.runPath('exp-gamma'), 'results.json');
  const tampered = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  tampered.totals.propagatedMin = 99999;
  fs.writeFileSync(resultsPath, JSON.stringify(tampered));

  assert.throws(() => archive.promote('exp-gamma', { simulate: runSimulation }), IsolationError);
});

test('runId 路径穿越被拒绝', () => {
  const { experiments, archive } = makeStores();
  for (const bad of ['../x', 'a/b', '..', '', 'a\\b']) {
    assert.throws(() => experiments.runPath(bad), IsolationError, `应拒绝 ${JSON.stringify(bad)}`);
    assert.throws(() => archive.runPath(bad), IsolationError, `应拒绝 ${JSON.stringify(bad)}`);
  }
});

test('实验区与存档区不允许指向同一目录', () => {
  const root = tempRoot();
  const shared = path.join(root, 'shared');
  const experiments = new ExperimentStore(shared);
  assert.throws(() => new ArchiveStore(shared, experiments), IsolationError);
});
