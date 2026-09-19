// 确定性随机数：同一随机种子必须复现同一态势。
// 采用 cyrb128 哈希派生种子 + sfc32 生成器；各模块（航班计划 / 风况 / 运控扰动）
// 使用按名称派生的独立子流，互不消耗对方的随机序列，保证单模块改动不污染其他模块。

function cyrb128(text) {
  const str = String(text);
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function sfc32(a, b, c, d) {
  return function next() {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function createRng(seed) {
  const next = sfc32(...cyrb128(seed));
  let spare = null;
  const rng = {
    next,
    uniform(min = 0, max = 1) {
      return min + next() * (max - min);
    },
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p) {
      return next() < p;
    },
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    exponential(mean) {
      return -mean * Math.log(1 - next());
    },
    normal() {
      if (spare !== null) {
        const value = spare;
        spare = null;
        return value;
      }
      let u = 0;
      while (u === 0) u = next();
      const mag = Math.sqrt(-2 * Math.log(u));
      const angle = 2 * Math.PI * next();
      spare = mag * Math.sin(angle);
      return mag * Math.cos(angle);
    },
  };
  return rng;
}

// 由主种子派生各模块的独立随机流
export function spawnStreams(masterSeed) {
  return {
    schedule: createRng(`${masterSeed}|schedule`),
    weather: createRng(`${masterSeed}|weather`),
    ops: createRng(`${masterSeed}|ops`),
  };
}
