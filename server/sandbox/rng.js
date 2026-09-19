// 确定性随机数工具：与 server/engine.js 相同的 FNV-1a 哈希 + mulberry32 风格。
// 通过 "<seed>:sandbox:<stream>" 派生互相独立的随机流，
// 保证同一种子必然复现同一态势（天气场、班表、运行噪声互不串扰）。

export function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRng(streamKey) {
  let value = hashString(streamKey);
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function createStreamRng(seed, stream) {
  return createRng(`${seed}:sandbox:${stream}`);
}

// Box-Muller：消耗两个均匀随机数，产出标准正态样本。
export function randomNormal(rng) {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, precision = 1) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
