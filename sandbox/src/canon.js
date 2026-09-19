// 规范化序列化：键排序 + 数值定点化，保证同一态势的字节级一致，哈希可比对。
import { createHash } from 'node:crypto';

export function canonicalize(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 : null;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function contentHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
