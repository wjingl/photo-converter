'use strict';
/* 生成 E2E 测试图片（确定性：种子随机数），输出到 tests/fixtures/ */
const fs = require('node:fs');
const path = require('node:path');
const PI = require('../src/logic.js');

// 确定性 PRNG（mulberry32）
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeImage(w, h, fn) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = fn(x, y);
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
  }
  return rgba;
}

// 平滑值噪声（分形八度可叠加，任何缩放级别都保留细节）
function makeValueNoise(seed) {
  const r2 = rng(seed);
  return function noiseFn(w, h, scale) {
    const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2;
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = r2();
    return (x, y) => {
      const gx = x / scale, gy = y / scale;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = gx - x0, fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1];
      const c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
      return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    };
  };
}

async function writePng(name, w, h, rgba) {
  const bytes = await PI.encodePng({ width: w, height: h, rgba, mode: 'rgba' });
  fs.writeFileSync(path.join(__dirname, '..', 'tests', 'fixtures', name), bytes);
  console.log(`${name}: ${w}x${h}, ${(bytes.length / 1024).toFixed(1)} KB`);
}

(async () => {
  fs.mkdirSync(path.join(__dirname, '..', 'tests', 'fixtures'), { recursive: true });
  const r = rng(20260811);
  const noise = () => Math.floor(r() * 18);

  // 1. 大图：天空渐变 + 六层分形噪声（照片感纹理，缩放后仍保留丰富细节）
  const noisePhoto = makeValueNoise(777);
  const oct1 = noisePhoto(3000, 2000, 160); // 低频云（12.8px@240）
  const oct2 = noisePhoto(3000, 2000, 40);  // 中频（3.2px@240）
  const oct3 = noisePhoto(3000, 2000, 12);  // 高频（~1px@240）
  const oct4 = noisePhoto(3000, 2000, 5);   // 极高频（0.4px@240）
  await writePng('big-photo.png', 3000, 2000, makeImage(3000, 2000, (x, y) => {
    const t = y / 2000;
    const v = oct1(x, y) * 130 + oct2(x, y) * 110 + oct3(x, y) * 60 + oct4(x, y) * 28;
    const n = Math.round(v);
    if (t < 0.55) {
      const b = Math.round(205 - 135 * t + n);
      return [Math.round(145 - 95 * t + n), Math.round(175 - 85 * t + n * 0.8), Math.round(b + 40), 255];
    }
    return [Math.round(45 + oct1(x, y) * 50 + n * 0.6), Math.round(120 + oct2(x, y) * 60 + n * 0.8), Math.round(60 + oct1(x, y) * 45), 255];
  }));

  // 2. 小图（触发上采样+增强）
  await writePng('small.png', 100, 80, makeImage(100, 80, (x, y) => {
    const v = Math.round(120 + 100 * Math.sin(x / 9) * Math.cos(y / 7) + noise());
    return [v, Math.round(v * 0.8), Math.round(v * 0.6), 255];
  }));

  // 3. 超高（触发 3:7 上下裁剪）
  await writePng('tall.png', 2000, 4000, makeImage(2000, 4000, (x, y) => {
    const v = Math.round(60 + 180 * (y / 4000));
    return [v, Math.round(40 + 150 * (y / 4000)), Math.round(v * 0.5), 255];
  }));

  // 4. 超宽（触发居中左右裁剪）
  await writePng('wide.png', 4000, 1500, makeImage(4000, 1500, (x, y) => {
    const v = Math.round(50 + 200 * (x / 4000));
    return [Math.round(v * 0.9), v, Math.round(60 + 100 * (y / 1500)), 255];
  }));

  // 5. 纯色（简单内容：最高质量仍小于目标大小）
  await writePng('solid.png', 2400, 1600, makeImage(2400, 1600, () => [189, 147, 249, 255]));

  // 6. 低对比小图（触发增强）
  await writePng('lowcontrast.png', 64, 48, makeImage(64, 48, () => {
    const v = 120 + Math.floor(r() * 20);
    return [v, v, v, 255];
  }));

  // 7. 带透明通道（验证 alpha 保留）
  await writePng('withalpha.png', 800, 600, makeImage(800, 600, (x, y) => {
    const c = Math.round(255 * (x / 800));
    return x < 400 ? [c, 255 - c, 128, 200] : [c, 255 - c, 128, 255];
  }));
})().catch((e) => { console.error(e); process.exit(1); });
