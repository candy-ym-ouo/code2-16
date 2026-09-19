// 多日风场模拟：
// - 空间：粗网格标准正态创新场双线性插值到细网格，形成空间相关的风场；
// - 时间：逐日 AR(1) 演变（W_d - mean = rho·(W_{d-1} - mean) + √(1-rho²)·σ·ε_d），
//   保证日际连续性（rho 越大，风况越“粘滞”）；
// - 气候背景：叠加随纬度变化的盛行西风。
// 整个风场由 weather 随机流唯一驱动，同一种子逐日逐格完全一致。

function makeGrid(latMin, latMax, lonMin, lonMax, step) {
  return {
    latMin,
    lonMin,
    step,
    rows: Math.round((latMax - latMin) / step) + 1,
    cols: Math.round((lonMax - lonMin) / step) + 1,
  };
}

// 覆盖主要航路区域（约略对应国内范围）
const FINE = makeGrid(18, 54, 73, 135, 2);
const COARSE = makeGrid(16, 56, 72, 136, 8);

function bilinear(field, grid, lat, lon) {
  const gx = (lon - grid.lonMin) / grid.step;
  const gy = (lat - grid.latMin) / grid.step;
  const x0 = Math.max(0, Math.min(grid.cols - 1, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(grid.rows - 1, Math.floor(gy)));
  const x1 = Math.min(grid.cols - 1, x0 + 1);
  const y1 = Math.min(grid.rows - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, gx - x0));
  const ty = Math.max(0, Math.min(1, gy - y0));
  const f00 = field[y0 * grid.cols + x0];
  const f10 = field[y0 * grid.cols + x1];
  const f01 = field[y1 * grid.cols + x0];
  const f11 = field[y1 * grid.cols + x1];
  return (f00 * (1 - tx) + f10 * tx) * (1 - ty) + (f01 * (1 - tx) + f11 * tx) * ty;
}

function westerlyMean(lat, amplitude) {
  return Math.max(0, amplitude * Math.sin((Math.PI * (lat - 18)) / 36));
}

export class WindField {
  constructor(weather, rng, days) {
    this.weather = weather;
    this.days = days;
    this.u = []; // 逐日纬向风（m/s，向东为正）
    this.v = []; // 逐日经向风（m/s，向北为正）
    const cells = FINE.rows * FINE.cols;
    const decay = Math.sqrt(1 - weather.rho ** 2);
    let prevU = null;
    let prevV = null;
    for (let d = 0; d < days; d++) {
      // 当日创新场：粗网格正态 → 细网格插值（空间相关）
      const coarseU = [];
      const coarseV = [];
      for (let i = 0; i < COARSE.rows * COARSE.cols; i++) {
        coarseU.push(rng.normal());
        coarseV.push(rng.normal());
      }
      const u = new Float64Array(cells);
      const v = new Float64Array(cells);
      for (let r = 0; r < FINE.rows; r++) {
        const lat = FINE.latMin + r * FINE.step;
        const mean = westerlyMean(lat, weather.westerlyMs);
        for (let c = 0; c < FINE.cols; c++) {
          const idx = r * FINE.cols + c;
          const lon = FINE.lonMin + c * FINE.step;
          const eu = bilinear(coarseU, COARSE, lat, lon);
          const ev = bilinear(coarseV, COARSE, lat, lon);
          if (prevU) {
            u[idx] = mean + weather.rho * (prevU[idx] - mean) + decay * weather.sigmaMs * eu;
            v[idx] = weather.rho * prevV[idx] + decay * weather.sigmaMs * ev;
          } else {
            u[idx] = mean + weather.sigmaMs * eu;
            v[idx] = weather.sigmaMs * ev;
          }
        }
      }
      this.u.push(u);
      this.v.push(v);
      prevU = u;
      prevV = v;
    }
  }

  // 高空风采样（双线性插值），day 越界时钳到最后一天
  sample(day, lat, lon) {
    const d = Math.max(0, Math.min(this.days - 1, day));
    return { u: bilinear(this.u[d], FINE, lat, lon), v: bilinear(this.v[d], FINE, lat, lon) };
  }

  // 地面风：高空风按比例折算 + 固定日变化曲线（午后增强），无需额外随机量
  surfaceAt(day, lat, lon, hour) {
    const { u, v } = this.sample(day, lat, lon);
    const diurnal = 1 + 0.15 * Math.sin((2 * Math.PI * (hour - 14)) / 24);
    return Math.hypot(u, v) * this.weather.surfaceFactor * diurnal;
  }
}
