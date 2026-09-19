import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSandbox, simulate } from '../sandbox/simulation.js';
import {
  GALE_GUST_LIMIT,
  STORM_GUST_LIMIT,
  generateWeatherField
} from '../sandbox/weather.js';
import {
  ALL_ISLANDS,
  TURNAROUND_HOURS,
  bearingBetween
} from '../sandbox/schedule.js';
import { SandboxIsolationError, SandboxStore } from '../sandbox/store.js';

function constantWeather(days, windFor) {
  const hours = [];
  for (let hour = 0; hour < days * 24; hour += 1) {
    const islands = {};
    for (const island of ALL_ISLANDS) {
      islands[island.id] = windFor(island.id, hour);
    }
    hours.push({
      hour,
      day: Math.floor(hour / 24) + 1,
      hourOfDay: hour % 24,
      islands
    });
  }
  return { seed: 'injected', days, hours };
}

function twoLegSchedule() {
  return {
    legs: [
      {
        id: 'T-1', day: 1, courierId: 'zephyr', callSign: 'Z-01',
        originId: 'skyport', destId: 'sun',
        schedDepHour: 8, distanceKm: 82, baseHours: 1, baseSpeed: 82
      },
      {
        id: 'T-2', day: 1, courierId: 'zephyr', callSign: 'Z-01',
        originId: 'sun', destId: 'skyport',
        schedDepHour: 9.8, distanceKm: 82, baseHours: 1, baseSpeed: 82
      }
    ]
  };
}

test('同一随机种子复现同一态势', () => {
  const first = runSandbox({ seed: 'replay-seed', days: 5 });
  const second = runSandbox({ seed: 'replay-seed', days: 5 });
  const other = runSandbox({ seed: 'replay-seed-2', days: 5 });

  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.events, second.events);
  assert.deepEqual(first.weather, second.weather);
  assert.deepEqual(first.schedule, second.schedule);
  assert.notEqual(first.digest, other.digest);
});

test('多日风况场由种子决定且阵风标记自洽', () => {
  const field = generateWeatherField('wind-check', 3, ALL_ISLANDS);
  const again = generateWeatherField('wind-check', 3, ALL_ISLANDS);

  assert.deepEqual(field, again);
  assert.equal(field.hours.length, 72);
  for (const hour of field.hours) {
    for (const islandId of Object.keys(hour.islands)) {
      const wind = hour.islands[islandId];
      assert.ok(wind.gust >= wind.strength);
      assert.equal(wind.gale, wind.gust >= GALE_GUST_LIMIT);
      assert.equal(wind.storm, wind.gust >= STORM_GUST_LIMIT);
    }
  }
});

test('前段天气延误沿机队轮转传播到后续航班', () => {
  const origin = ALL_ISLANDS.find((island) => island.id === 'skyport');
  const dest = ALL_ISLANDS.find((island) => island.id === 'sun');
  const bearing = bearingBetween(origin, dest);
  // 风向与航向垂直，排除顶风干扰，只保留强风软性延误
  const calm = { strength: 6, gust: 8, angle: bearing + 90, gale: false, storm: false };
  const gale = { ...calm, gust: GALE_GUST_LIMIT + 1, gale: true };
  const weather = constantWeather(1, (islandId) => (islandId === 'skyport' ? gale : calm));

  const { events } = simulate({
    seed: 'propagation',
    days: 1,
    schedule: twoLegSchedule(),
    weather,
    islands: ALL_ISLANDS
  });

  const [first, second] = events;
  assert.equal(first.status, 'operated');
  assert.ok(first.weatherDelayMin >= 30, `首段应受强风软性延误，实际 ${first.weatherDelayMin}`);
  assert.ok(second.rotationDelayMin > 0, '次段应继承前段晚到产生的传播延误');
  assert.ok(second.depDelayMin >= second.rotationDelayMin);
  assert.ok(second.arrHour > first.arrHour + TURNAROUND_HOURS - 1e-9);
});

test('烈风停飞导致取消并引发运力错位级联', () => {
  const storm = { strength: 20, gust: STORM_GUST_LIMIT + 4, angle: 0, gale: true, storm: true };
  const weather = constantWeather(1, () => storm);

  const { events } = simulate({
    seed: 'storm-day',
    days: 1,
    schedule: twoLegSchedule(),
    weather,
    islands: ALL_ISLANDS
  });

  assert.equal(events[0].status, 'cancelled');
  assert.equal(events[0].cancelReason, 'weather-ground-stop');
  assert.equal(events[1].status, 'cancelled');
  assert.equal(events[1].cancelReason, 'aircraft-out-of-position');
});

test('实验数据与正式存档隔离', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-'));
  const formalSave = path.join(root, 'game-state.json');
  const store = new SandboxStore(path.join(root, 'sandbox'), { formalSavePath: formalSave });

  store.saveExperiment('run-1', 'summary', { digest: 'abc' });
  assert.equal(store.list('experiment').length, 1);
  assert.equal(store.list('archive').length, 0);
  assert.deepEqual(store.loadExperiment('run-1', 'summary'), { digest: 'abc' });

  // 实验区数据不能按正式存档读取
  assert.throws(() => store.loadArchived('run-1', 'summary'), SandboxIsolationError);

  // 越界路径被拒绝
  assert.throws(() => store.saveExperiment('..', 'x', {}), SandboxIsolationError);
  assert.throws(() => store.saveExperiment('run-1', '../game-state', {}), SandboxIsolationError);

  // 伪造分区标记的实验区数据混入正式存档区时被拒绝
  const rogueDir = path.join(root, 'sandbox', 'archive', 'run-2');
  fs.mkdirSync(rogueDir, { recursive: true });
  fs.writeFileSync(path.join(rogueDir, 'x.json'), JSON.stringify({ zone: 'experiment', payload: {} }));
  assert.throws(() => store.loadArchived('run-2', 'x'), /不得混入正式存档/);

  // 显式归档是唯一通道，且正式存档不可覆盖
  store.promote('run-1', 'summary');
  assert.deepEqual(store.loadArchived('run-1', 'summary'), { digest: 'abc' });
  assert.throws(() => store.promote('run-1', 'summary'), SandboxIsolationError);

  // 沙盘根目录不得覆盖正式存档
  assert.throws(
    () => new SandboxStore(root, { formalSavePath: formalSave }),
    SandboxIsolationError
  );
});

test('实验产物可字节级复现', () => {
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-a-'));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-b-'));
  const firstStore = new SandboxStore(path.join(firstRoot, 'sandbox'));
  const secondStore = new SandboxStore(path.join(secondRoot, 'sandbox'));

  const first = runSandbox({ seed: 'byte-replay', days: 3 });
  const second = runSandbox({ seed: 'byte-replay', days: 3 });
  firstStore.saveExperiment('run-x', 'events', first.events);
  secondStore.saveExperiment('run-x', 'events', second.events);

  const firstFile = fs.readFileSync(
    path.join(firstRoot, 'sandbox', 'experiments', 'run-x', 'events.json'),
    'utf8'
  );
  const secondFile = fs.readFileSync(
    path.join(secondRoot, 'sandbox', 'experiments', 'run-x', 'events.json'),
    'utf8'
  );
  assert.equal(firstFile, secondFile);
});
