#!/usr/bin/env node
// 航线风险沙盘 CLI：
//   node server/sandbox/cli.js run --seed demo --days 5 [--run-id x] [--data dir]
//   node server/sandbox/cli.js verify --seed demo --days 5
//   node server/sandbox/cli.js list [--data dir]
//   node server/sandbox/cli.js promote --run-id x --name summary [--data dir]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSandbox } from './simulation.js';
import { SandboxStore } from './store.js';

const DEFAULT_DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'sandbox'
);

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function printSummary(result) {
  console.log(`航线风险沙盘  seed=${result.seed}  天数=${result.days}`);
  for (const day of result.summary.days) {
    console.log(
      `  第 ${day.day} 日：航班 ${day.legs}，取消 ${day.cancelled}，` +
      `平均延误 ${day.avgDepDelayMin} 分，P95 ${day.p95DepDelayMin} 分，` +
      `天气延误 ${day.weatherDelayMin} 分，传播延误 ${day.rotationDelayMin} 分`
    );
  }
  const total = result.summary.total;
  console.log(
    `  合计：航班 ${total.legs}，取消 ${total.cancelled}，总延误 ${total.totalDelayMin} 分，` +
    `传播占比 ${(total.propagatedShare * 100).toFixed(1)}%`
  );
  console.log(`  态势摘要 (SHA-256)：${result.digest}`);
}

function commandRun(options) {
  const seed = String(options.seed ?? 'sandbox-demo');
  const days = Number(options.days ?? 5);
  const runId = options['run-id'] ?? `seed-${seed}-d${days}`;
  const store = new SandboxStore(options.data ?? DEFAULT_DATA_DIR);

  const result = runSandbox({ seed, days });
  store.saveExperiment(runId, 'events', result.events);
  store.saveExperiment(runId, 'summary', result.summary);

  printSummary(result);
  console.log(`实验区文件（与正式存档隔离）：${path.join(store.zoneDir('experiment'), runId)}`);
}

function commandVerify(options) {
  const seed = String(options.seed ?? 'sandbox-demo');
  const days = Number(options.days ?? 5);
  const first = runSandbox({ seed, days });
  const second = runSandbox({ seed, days });
  const same = first.digest === second.digest
    && JSON.stringify(first.events) === JSON.stringify(second.events)
    && JSON.stringify(first.weather) === JSON.stringify(second.weather);

  if (same) {
    console.log(`态势复现一致：seed=${seed}，days=${days}，digest=${first.digest}`);
    process.exitCode = 0;
  } else {
    console.error(`复现失败：同一种子产生了不同态势（${first.digest} vs ${second.digest}）`);
    process.exitCode = 1;
  }
}

function commandList(options) {
  const store = new SandboxStore(options.data ?? DEFAULT_DATA_DIR);
  for (const zone of ['experiment', 'archive']) {
    const entries = store.list(zone);
    console.log(`${store.zoneDir(zone)}（${entries.length} 项）`);
    for (const entry of entries) {
      console.log(`  ${entry.runId}/${entry.name}`);
    }
  }
}

function commandPromote(options) {
  const store = new SandboxStore(options.data ?? DEFAULT_DATA_DIR);
  const runId = options['run-id'];
  const name = options.name;
  if (!runId || !name) {
    console.error('promote 需要 --run-id 与 --name 参数。');
    process.exitCode = 1;
    return;
  }
  store.promote(runId, name);
  console.log(`已归档：${runId}/${name}（实验区 → 正式存档区，正式存档不可覆盖）`);
}

const options = parseArgs(process.argv.slice(2));
const command = options._[0];

try {
  if (command === 'run') {
    commandRun(options);
  } else if (command === 'verify') {
    commandVerify(options);
  } else if (command === 'list') {
    commandList(options);
  } else if (command === 'promote') {
    commandPromote(options);
  } else {
    console.log('用法：node server/sandbox/cli.js <run|verify|list|promote> [--seed x] [--days n] [--run-id x] [--name x] [--data dir]');
    process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(`沙盘执行失败：${error.message}`);
  process.exitCode = 1;
}
