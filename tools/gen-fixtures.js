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

async function writePng(name, w, h, rgba) {
  const bytes = await PI.encodePng({ width: w, height: h, rgba, mode: 'rgba' });
  fs.writeFileSync(path.join(__dirname, '..', 'tests', 'fixtures', name), bytes);
  console.log(`${name}: ${w}x${h}, ${(bytes.length / 1024).toFixed(1)} KB`);
}

(async () => {
  fs.mkdirSync(path.join(__dirname, '..', 'tests', 'fixtures'), { recursive: true });
  const r = rng(20260811);
  const noise = () => Math.floor(r() * 18);

  // 1. 大图：天空渐变 + 噪点 + 地面（照片感，触发高质量压缩）
  await writePng('big-photo.png', 3000, 2000, makeImage(3000, 2000, (x, y) => {
    const t = y / 2000;
    if (t < 0.55) {
      const b = Math.round(200 - 130 * t + noise());
      return [Math.round(140 - 90 * t + noise()), Math.round(170 - 80 * t + noise()), Math.round(b + 40), 255];
    }
    const g = Math.round(120 + (r() * 30));
    return [Math.round(40 + r() * 30), Math.round(g), Math.round(60 + r() * 40), 255];
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
