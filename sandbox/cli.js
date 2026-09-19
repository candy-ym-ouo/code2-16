#!/usr/bin/env node
// 航线风险沙盘 CLI
//   node sandbox/cli.js run [--seed 42] [--days 7] [--tails 12] [--legs 4] [--name exp]
//   node sandbox/cli.js list                 列出实验区全部实验
//   node sandbox/cli.js show <runId>         查看某次实验结果
//   node sandbox/cli.js promote <runId>      复算验证后晋升到正式存档
//   node sandbox/cli.js archive              列出正式存档
import { runSimulation } from './src/engine.js';
import { normalizeConfig } from './src/config.js';
import { createStores } from './src/storage.js';
import { contentHash } from './src/canon.js';

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

function fmt(minutes) {
  return Number(minutes).toFixed(1);
}

function printTotals(totals) {
  console.log(`  班次 ${totals.flights}（取消 ${totals.canceled}）  平均到港延误 ${fmt(totals.avgArrDelay)} 分钟  P95 ${fmt(totals.p95ArrDelay)} 分钟  最大 ${fmt(totals.maxArrDelay)} 分钟`);
  console.log(`  一次延误 ${fmt(totals.primaryMin)} 分钟（机械 ${fmt(totals.mechMin)} / 流控 ${fmt(totals.flowMin)} / 大风 ${fmt(totals.weatherHoldMin)}）`);
  console.log(`  传播延误 ${fmt(totals.propagatedMin)} 分钟  传播系数 ${fmt(totals.propagationRatio)}  风况影响 ${fmt(totals.windMin)} 分钟  容量排队 ${fmt(totals.congestionMin)} 分钟`);
}

const [cmd, ...rest] = process.argv.slice(2);
const { experiments, archive, root } = createStores();

try {
  runCommand(cmd, rest, { experiments, archive, root });
} catch (error) {
  console.error(`[沙盘] 错误：${error.message}`);
  process.exit(1);
}

function runCommand(cmd, rest, { experiments, archive, root }) {
  switch (cmd) {
  case 'run': {
    const flags = parseFlags(rest);
    const overrides = {
      seed: flags.seed !== undefined ? Number(flags.seed) : 42,
      days: flags.days !== undefined ? Number(flags.days) : 7,
    };
    if (flags.tails !== undefined) overrides.tails = Number(flags.tails);
    if (flags.legs !== undefined) overrides.legsPerDay = Number(flags.legs);
    const config = normalizeConfig(overrides);
    const results = runSimulation(config);
    const name = typeof flags.name === 'string' ? flags.name : 'exp';
    const runId = `${name}-${contentHash(config).slice(0, 8)}`;
    const { resultsHash } = experiments.saveRun(runId, config, results);
    console.log(`[沙盘] 实验已保存 → ${root}/experiments/${runId}`);
    printTotals(results.totals);
    console.log(`  种子 ${config.seed}（同一种子可完整复现本态势）  结果哈希 ${resultsHash.slice(0, 16)}…`);
    break;
  }
  case 'list': {
    const runs = experiments.listRuns();
    if (runs.length === 0) {
      console.log('[沙盘] 实验区为空，先执行 run 生成实验');
      break;
    }
    console.log(`[沙盘] 实验区（${root}/experiments）共 ${runs.length} 次实验：`);
    for (const run of runs) {
      console.log(`  ${run.runId}  种子 ${run.seed ?? '?'}  哈希 ${String(run.resultsHash || '').slice(0, 12)}…  ${run.createdAt ?? ''}`);
    }
    break;
  }
  case 'show': {
    const runId = rest[0];
    if (!runId) throw new Error('用法：show <runId>');
    const results = experiments.loadResults(runId);
    console.log(`[沙盘] 实验 ${runId}（种子 ${results.config.seed}，${results.config.days} 日）`);
    printTotals(results.totals);
    break;
  }
  case 'promote': {
    const runId = rest[0];
    if (!runId) throw new Error('用法：promote <runId>');
    const { verified } = archive.promote(runId, { simulate: runSimulation });
    console.log(`[沙盘] ${runId} 已晋升至正式存档（复算校验${verified ? '通过' : '跳过'}）→ ${root}/archive/${runId}`);
    break;
  }
  case 'archive': {
    const entries = archive.list();
    if (entries.length === 0) {
      console.log('[沙盘] 正式存档为空（实验数据与存档隔离，须 promote 晋升）');
      break;
    }
    console.log(`[沙盘] 正式存档（${root}/archive）共 ${entries.length} 条：`);
    for (const entry of entries) {
      console.log(`  ${entry.runId}  校验${entry.verified ? '通过' : '跳过'}  哈希 ${String(entry.resultsHash || '').slice(0, 12)}…  ${entry.promotedAt ?? ''}`);
    }
    break;
  }
  default:
    console.log(`航线风险沙盘 —— 多日风况与延误传播模拟
用法：
  node sandbox/cli.js run [--seed 42] [--days 7] [--tails 12] [--legs 4] [--name exp]
  node sandbox/cli.js list                 列出实验区全部实验
  node sandbox/cli.js show <runId>         查看某次实验结果
  node sandbox/cli.js promote <runId>      复算验证后晋升到正式存档
  node sandbox/cli.js archive              列出正式存档`);
}
}
