// 沙盘数据隔离存储：实验区（experiments/）与正式存档区（archive/）物理分离。
// - 沙盘根目录在构造时校验：不得覆盖正式存档（game-state.json）。
// - 实验数据只能写入实验区；进入正式存档区的唯一通道是显式 promote（归档）。
// - 正式存档不可覆盖；按正式存档读取时会校验分区标记，拒绝实验区数据混入。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class SandboxIsolationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SandboxIsolationError';
  }
}

export const ZONES = { experiment: 'experiments', archive: 'archive' };

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const DEFAULT_FORMAL_SAVE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'game-state.json'
);

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export class SandboxStore {
  constructor(rootDir, { formalSavePath = DEFAULT_FORMAL_SAVE } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.formalSavePath = path.resolve(formalSavePath);
    if (this.formalSavePath === this.rootDir || isInside(this.rootDir, this.formalSavePath)) {
      throw new SandboxIsolationError('沙盘数据区不得覆盖正式存档。');
    }
  }

  zoneDir(zone) {
    const directory = ZONES[zone];
    if (!directory) {
      throw new SandboxIsolationError(`未知的数据分区：${zone}`);
    }
    return path.join(this.rootDir, directory);
  }

  resolve(zone, runId, name) {
    if (!NAME_PATTERN.test(runId) || !NAME_PATTERN.test(name)) {
      throw new SandboxIsolationError(`非法的实验标识：${runId}/${name}`);
    }
    const zoneDir = this.zoneDir(zone);
    const filePath = path.resolve(zoneDir, runId, `${name}.json`);
    if (!isInside(zoneDir, filePath)) {
      throw new SandboxIsolationError('越界访问被拒绝：实验数据不得离开所属分区。');
    }
    if (filePath === this.formalSavePath) {
      throw new SandboxIsolationError('禁止写入正式存档。');
    }
    return filePath;
  }

  saveExperiment(runId, name, payload) {
    this.write(this.resolve('experiment', runId, name), {
      zone: 'experiment',
      runId,
      name,
      payload
    });
  }

  loadExperiment(runId, name) {
    const doc = this.readDoc(this.resolve('experiment', runId, name));
    if (doc.zone !== 'experiment') {
      throw new SandboxIsolationError('数据分区标记不符：预期为实验区数据。');
    }
    return doc.payload;
  }

  loadArchived(runId, name) {
    const doc = this.readDoc(this.resolve('archive', runId, name));
    if (doc.zone !== 'archive') {
      throw new SandboxIsolationError('实验区数据不得混入正式存档，请先执行归档（promote）。');
    }
    return doc.payload;
  }

  // 实验区 → 正式存档区的唯一通道：显式归档，且正式存档不可覆盖。
  promote(runId, name) {
    const source = this.readDoc(this.resolve('experiment', runId, name));
    if (source.zone !== 'experiment') {
      throw new SandboxIsolationError('只有实验区数据可以归档。');
    }
    const target = this.resolve('archive', runId, name);
    if (fs.existsSync(target)) {
      throw new SandboxIsolationError('正式存档已存在，不可覆盖。');
    }
    this.write(target, {
      zone: 'archive',
      runId,
      name,
      promotedFrom: { zone: 'experiment', runId, name },
      payload: source.payload
    });
    const manifest = path.join(this.zoneDir('archive'), 'manifest.jsonl');
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.appendFileSync(manifest, `${JSON.stringify({ runId, name })}\n`, 'utf8');
  }

  list(zone) {
    const zoneDir = this.zoneDir(zone);
    if (!fs.existsSync(zoneDir)) return [];
    const entries = [];
    for (const runId of fs.readdirSync(zoneDir)) {
      const runDir = path.join(zoneDir, runId);
      if (!fs.statSync(runDir).isDirectory()) continue;
      for (const file of fs.readdirSync(runDir)) {
        if (file.endsWith('.json')) {
          entries.push({ runId, name: file.slice(0, -'.json'.length) });
        }
      }
    }
    return entries.sort((first, second) => (
      first.runId === second.runId
        ? (first.name < second.name ? -1 : 1)
        : (first.runId < second.runId ? -1 : 1)
    ));
  }

  readDoc(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new SandboxIsolationError(`数据不存在：${path.relative(this.rootDir, filePath)}`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  write(filePath, doc) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
      fs.renameSync(tempPath, filePath);
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }
}
