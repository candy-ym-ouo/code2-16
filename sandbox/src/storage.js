// 存储隔离：实验数据与正式存档物理分离。
// - ExperimentStore：实验区，所有模拟结果只能先落在这里；
// - ArchiveStore：正式存档，只读——唯一写入口是 promote()，
//   晋升前默认重新模拟复算并比对内容哈希，且写一次不可覆盖；
// - runId 校验 + 路径包含检查，杜绝路径穿越把实验数据写进存档区。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, contentHash } from './canon.js';

export class IsolationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IsolationError';
  }
}

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function ensureInside(root, target) {
  const rel = path.relative(root, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new IsolationError(`路径越界：${target} 不在 ${root} 之内`);
  }
}

function writeJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}

function validateRunDir(root, runId) {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new IsolationError(`非法 runId：${JSON.stringify(runId)}（只允许字母数字与 . _ -）`);
  }
  const dir = path.resolve(root, runId);
  ensureInside(root, dir);
  return dir;
}

export class ExperimentStore {
  constructor(root) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
  }

  runPath(runId) {
    return validateRunDir(this.root, runId);
  }

  // 实验结果只写入实验区；同一 runId 重复保存是幂等的（同种子同配置 → 同内容）
  saveRun(runId, config, results) {
    const dir = this.runPath(runId);
    fs.mkdirSync(dir, { recursive: true });
    const resultsHash = contentHash(results);
    writeJson(dir, 'config.json', config);
    fs.writeFileSync(path.join(dir, 'results.json'), `${canonicalJson(results)}\n`);
    writeJson(dir, 'meta.json', {
      runId,
      zone: 'experiment',
      seed: config.seed,
      createdAt: new Date().toISOString(),
      resultsHash,
    });
    return { runId, dir, resultsHash };
  }

  loadConfig(runId) {
    return readJson(this.runPath(runId), 'config.json');
  }

  loadResults(runId) {
    return readJson(this.runPath(runId), 'results.json');
  }

  listRuns() {
    if (!fs.existsSync(this.root)) return [];
    return fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        try {
          return readJson(path.join(this.root, entry.name), 'meta.json');
        } catch {
          return { runId: entry.name, zone: 'experiment' };
        }
      })
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }
}

export class ArchiveStore {
  constructor(root, experimentStore) {
    this.root = path.resolve(root);
    this.experiments = experimentStore;
    if (this.root === experimentStore.root) {
      throw new IsolationError('正式存档与实验区必须位于不同目录');
    }
    fs.mkdirSync(this.root, { recursive: true });
  }

  runPath(runId) {
    return validateRunDir(this.root, runId);
  }

  // 正式存档禁止任何直接写入
  save() {
    throw new IsolationError('正式存档为只读区：实验须先落在实验区，经复算验证后通过 promote() 晋升');
  }

  // 晋升：从实验区拷贝到正式存档。verify 时重新模拟复算，哈希不一致即拒绝。
  promote(runId, { verify = true, simulate } = {}) {
    const srcDir = this.experiments.runPath(runId); // 来源必须在实验区内
    if (!fs.existsSync(srcDir)) throw new Error(`实验不存在：${runId}`);
    const config = this.experiments.loadConfig(runId);
    const storedResults = this.experiments.loadResults(runId);
    let verified = false;
    if (verify) {
      if (typeof simulate !== 'function') {
        throw new Error('promote 需要传入 simulate 函数用于复算验证');
      }
      const expected = contentHash(storedResults);
      const actual = contentHash(simulate(config));
      if (actual !== expected) {
        throw new IsolationError(`复算校验失败，拒绝晋升：${runId}（期望 ${expected}，复算 ${actual}）`);
      }
      verified = true;
    }
    const destDir = this.runPath(runId);
    if (fs.existsSync(destDir)) {
      throw new IsolationError(`正式存档已存在 ${runId}：存档写一次、不可覆盖`);
    }
    fs.mkdirSync(destDir, { recursive: true });
    for (const name of ['config.json', 'results.json', 'meta.json']) {
      fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
    }
    writeJson(destDir, 'PROMOTION.json', {
      runId,
      zone: 'archive',
      promotedAt: new Date().toISOString(),
      verified,
      resultsHash: contentHash(storedResults),
      source: srcDir,
    });
    return { runId, dir: destDir, verified };
  }

  list() {
    if (!fs.existsSync(this.root)) return [];
    return fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        try {
          return readJson(path.join(this.root, entry.name), 'PROMOTION.json');
        } catch {
          return { runId: entry.name, zone: 'archive' };
        }
      })
      .sort((a, b) => String(a.promotedAt).localeCompare(String(b.promotedAt)));
  }

  load(runId) {
    const dir = this.runPath(runId);
    return {
      config: readJson(dir, 'config.json'),
      results: readJson(dir, 'results.json'),
      promotion: readJson(dir, 'PROMOTION.json'),
    };
  }
}

// 默认数据根：sandbox/data/{experiments,archive}，可用 RISK_SANDBOX_DATA 覆盖（测试用临时目录）
export function createStores(baseRoot) {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const root = baseRoot || process.env.RISK_SANDBOX_DATA || path.resolve(moduleDir, '..', 'data');
  const experiments = new ExperimentStore(path.join(root, 'experiments'));
  const archive = new ArchiveStore(path.join(root, 'archive'), experiments);
  return { experiments, archive, root };
}
