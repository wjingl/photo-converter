# 批量图片转换工具 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个零联网的单文件 `index.html` 批量图片转换工具：任意图片/文件夹导入，统一输出为 50KB±2%、统一比例（默认 1:1）、最长边 240px，文件名不变，支持 JPEG/JPG/PNG，ZIP 批量导出，兼容 Windows/Linux/Android。

**Architecture:** 开发期拆分为 `src/logic.js`（纯逻辑，UMD 可被 Node 测试）、`src/app.js`（浏览器 UI+管线）、`src/style.css`、`src/index.template.html`，由 `build.js` 内联打包为最终单文件 `index.html`。纯逻辑全部用 `node --test` 做 TDD；浏览器部分 E2E 手动验证。

**Tech Stack:** 浏览器原生能力（canvas、createImageBitmap、CompressionStream、webkitdirectory、拖放 API、localStorage），零第三方依赖；Node 24 仅用于开发期测试与打包。

## Global Constraints

- 零联网：交付物 `index.html` 中不得出现 fetch/XHR/外链资源/`http` URL（`http://www.w3.org` 等 xmlns 也不得出现）
- 单文件交付：`index.html` 必须包含全部 CSS/JS，双击即可在 `file://` 下运行
- 输出统一：目标大小 **50 KB**，容差 **±2%**（JPEG 命中 [49,51]KB；PNG 承诺 ≤ 51KB）；最长边 **240px**；比例 **1:1**（可配 4:3/3:2/16:9/自定义）
- 裁剪规则：原图过宽 → 居中裁左右；原图过高 → 裁上下，**上方 30%、下方 70%（3:7）**
- 文件名不变（仅扩展名随格式替换）；ZIP 中保留文件夹相对路径，中文文件名必须 UTF-8 标志位（0x0800）
- 输出格式：保持原格式 / JPEG / JPG / PNG（JPG 与 JPEG 同为 JPEG 编码，仅扩展名不同）
- UI 中文、响应式（手机/桌面），暗色模式跟随系统
- 启动时序：UI 首帧立即可交互；引擎预热在首帧后异步执行（转换前就绪）
- 开发期环境：Node ≥ 18（实测 v24.16.0，全局 `CompressionStream` 可用）、Python 3.13（仅交叉验证 ZIP）
- 每次任务结束 commit（git 在 Task 1 初始化）

---

### Task 1: 脚手架 + CRC32 模块（TDD）

**Files:**
- Create: `src/logic.js`
- Create: `tests/logic.test.js`
- Create: `.gitignore`

**Interfaces:**
- Produces: `crc32(bytes, start?, end?) → number`（UMD，浏览器挂 `window.PI.crc32`，Node 挂 `module.exports.crc32`）

- [ ] **Step 1: git init + 目录**

```bash
cd "W:\0_proj\PHOTO_INTEGRATION"
git init
mkdir -p src tests tools
```

- [ ] **Step 2: 写失败测试**（`tests/logic.test.js` 开头部分）

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const PI = require('../src/logic.js');

test('crc32: 已知向量', () => {
  assert.strictEqual(PI.crc32(new Uint8Array(0)), 0x00000000);
  assert.strictEqual(PI.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.strictEqual(PI.crc32(new TextEncoder().encode('abc')), 0x352441C2);
});

test('crc32: 与 node:zlib 交叉验证（随机数据）', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  for (let t = 0; t < 20; t++) {
    const len = rnd() % 5000;
    const buf = new Uint8Array(len);
    for (let i = 0; i < len; i++) buf[i] = rnd() & 0xff;
    assert.strictEqual(PI.crc32(buf), zlib.crc32(buf), `len=${len}`);
  }
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test tests/logic.test.js`
Expected: 失败（Cannot find module '../src/logic.js'）

- [ ] **Step 4: 实现 `src/logic.js`（UMD 骨架 + crc32）**

```js
/* 纯逻辑引擎：UMD —— 浏览器挂 window.PI，Node 挂 module.exports */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- CRC32（查表法，IEEE 802.3）----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes, start = 0, end = bytes.length) {
    let c = 0xFFFFFFFF;
    for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // 后续任务在此追加 export
  return { crc32 };
});
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test tests/logic.test.js`
Expected: PASS（2 个测试，含 20 轮随机交叉验证）

- [ ] **Step 6: 写 `.gitignore`**

```gitignore
node_modules/
tests/out/
```

- [ ] **Step 7: Commit**

```bash
git add .gitignore src/logic.js tests/logic.test.js
git commit -m "feat: 脚手架与 CRC32 模块（UMD，Node 可测）"
```

---

### Task 2: PNG 编码器（TDD）

**Files:**
- Modify: `src/logic.js`（追加）
- Modify: `tests/logic.test.js`（追加）

**Interfaces:**
- Produces:
  - `encodePng({width, height, rgba?, indices?, palette?, mode}) → Promise<Uint8Array>`
    - `mode: 'rgb'`（colorType 2，alpha 在编码器内与白色混合）、`'rgba'`（colorType 6）、`'palette'`（colorType 3，需 `indices: Uint8Array` + `palette: [[r,g,b,a],...]`）
    - 过滤方式恒为 None（filter 0），压缩用 `CompressionStream('deflate')`（即 zlib 封装）
- 依赖：`crc32`（Task 1）

- [ ] **Step 1: 写失败测试**（追加到 `tests/logic.test.js`）

```js
// ---------- PNG 编码器 ----------
function parsePng(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.strictEqual(bytes[0], 0x89); assert.strictEqual(bytes[1], 0x50); // PNG 签名
  const chunks = [];
  let off = 8;
  while (off < bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const data = bytes.slice(off + 8, off + 8 + len);
    const crc = dv.getUint32(off + 8 + len);
    const calc = PI.crc32(bytes.slice(off + 4, off + 8 + len));
    assert.strictEqual(crc, calc, `chunk ${type} CRC`);
    chunks.push({ type, data });
    off += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const w = new DataView(ihdr.buffer).getUint32(0);
  const h = new DataView(ihdr.buffer).getUint32(4);
  const colorType = ihdr[9];
  const idat = chunks.filter((c) => c.type === 'IDAT').map((c) => c.data);
  const total = idat.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let o = 0; for (const c of idat) { merged.set(c, o); o += c.length; }
  const raw = zlib.inflateSync(merged);
  return { w, h, colorType, raw, chunks };
}

function unfilter(raw, w, h, channels) {
  const out = new Uint8Array(w * h * channels);
  const stride = 1 + w * channels;
  for (let y = 0; y < h; y++) {
    const rowStart = y * stride;
    assert.strictEqual(raw[rowStart], 0, 'filter 应为 None');
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < channels; c++) {
        out[(y * w + x) * channels + c] = raw[rowStart + 1 + x * channels + c];
      }
    }
  }
  return out;
}

test('encodePng rgb: 往返一致', async () => {
  const w = 3, h = 2;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = i * 40; rgba[i * 4 + 1] = i * 20 + 10; rgba[i * 4 + 2] = 255 - i * 30; rgba[i * 4 + 3] = 255; }
  const bytes = await PI.encodePng({ width: w, height: h, rgba, mode: 'rgb' });
  const png = parsePng(bytes);
  assert.strictEqual(png.w, w); assert.strictEqual(png.h, h); assert.strictEqual(png.colorType, 2);
  const px = unfilter(png.raw, w, h, 3);
  for (let i = 0; i < w * h; i++) {
    assert.strictEqual(px[i * 3], rgba[i * 4]);
    assert.strictEqual(px[i * 3 + 1], rgba[i * 4 + 1]);
    assert.strictEqual(px[i * 3 + 2], rgba[i * 4 + 2]);
  }
});

test('encodePng rgb: 半透明像素按公式与白色混合', async () => {
  const rgba = new Uint8ClampedArray([100, 150, 200, 128]);
  const bytes = await PI.encodePng({ width: 1, height: 1, rgba, mode: 'rgb' });
  const png = parsePng(bytes);
  const px = unfilter(png.raw, 1, 1, 3);
  const expect = (v) => Math.round(v * 128 / 255 + 255 * (1 - 128 / 255));
  assert.strictEqual(px[0], expect(100));
  assert.strictEqual(px[1], expect(150));
  assert.strictEqual(px[2], expect(200));
});

test('encodePng rgba: 保留 alpha 通道', async () => {
  const rgba = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80]);
  const bytes = await PI.encodePng({ width: 2, height: 1, rgba, mode: 'rgba' });
  const png = parsePng(bytes);
  assert.strictEqual(png.colorType, 6);
  const px = unfilter(png.raw, 2, 1, 4);
  assert.deepStrictEqual(Array.from(px), Array.from(rgba));
});

test('encodePng palette: PLTE/tRNS/索引正确', async () => {
  const w = 2, h = 1;
  const palette = [[255, 0, 0, 255], [0, 255, 0, 128]];
  const indices = new Uint8Array([0, 1]);
  const bytes = await PI.encodePng({ width: w, height: h, indices, palette, mode: 'palette' });
  const png = parsePng(bytes);
  assert.strictEqual(png.colorType, 3);
  const plte = png.chunks.find((c) => c.type === 'PLTE').data;
  assert.strictEqual(plte.length, 6);
  assert.deepStrictEqual(Array.from(plte), [255, 0, 0, 0, 255, 0]);
  const trns = png.chunks.find((c) => c.type === 'tRNS').data;
  assert.strictEqual(trns.length, 2);
  assert.deepStrictEqual(Array.from(trns), [255, 128]);
  const px = unfilter(png.raw, w, h, 1);
  assert.deepStrictEqual(Array.from(px), Array.from(indices));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/logic.test.js`
Expected: FAIL（`encodePng is not a function`）

- [ ] **Step 3: 实现**（追加到 `src/logic.js`，`return { crc32 }` 改为 `return { crc32, encodePng, zlibDeflate }`）

```js
  // ---------- 工具 ----------
  function u32le(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; }
  const encoder = new TextEncoder();

  // CompressionStream('deflate') = zlib 格式（PNG 用）；'deflate-raw' = 裸 deflate（ZIP 用）
  async function deflate(bytes, format) {
    const cs = new CompressionStream(format);
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = cs.readable.getReader();
    const parts = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const zlibDeflate = (bytes) => deflate(bytes, 'deflate');
  const rawDeflate = (bytes) => deflate(bytes, 'deflate-raw');

  // ---------- PNG 编码器 ----------
  function pngChunk(type, data) {
    const len = u32le(data.length);
    const typeBytes = encoder.encode(type);
    const crcBuf = new Uint8Array(typeBytes.length + data.length);
    crcBuf.set(typeBytes, 0); crcBuf.set(data, typeBytes.length);
    const crc = u32le(crc32(crcBuf));
    const out = new Uint8Array(12 + data.length);
    out.set(len, 0); out.set(typeBytes, 4); out.set(data, 8); out.set(crc, 8 + data.length);
    return out;
  }

  async function encodePng({ width, height, rgba, indices, palette, mode }) {
    if (!width || !height) throw new Error('PNG 尺寸无效');
    const channels = mode === 'rgba' ? 4 : mode === 'palette' ? 1 : 3;
    const raw = new Uint8Array(height * (1 + width * channels));
    let p = 0;
    for (let y = 0; y < height; y++) {
      raw[p++] = 0; // filter: None
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (mode === 'palette') {
          raw[p++] = indices[i / 4];
        } else if (mode === 'rgba') {
          raw[p++] = rgba[i]; raw[p++] = rgba[i + 1]; raw[p++] = rgba[i + 2]; raw[p++] = rgba[i + 3];
        } else { // rgb：alpha 与白色混合
          const a = rgba[i + 3] / 255;
          raw[p++] = Math.round(rgba[i] * a + 255 * (1 - a));
          raw[p++] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
          raw[p++] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
        }
      }
    }
    const idat = await zlibDeflate(raw);
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width); dv.setUint32(4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = mode === 'rgba' ? 6 : mode === 'palette' ? 3 : 2;
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const chunks = [pngChunk('IHDR', ihdr)];
    if (mode === 'palette') {
      const plte = new Uint8Array(palette.length * 3);
      const trns = new Uint8Array(palette.length);
      let hasTrns = false;
      for (let i = 0; i < palette.length; i++) {
        plte[i * 3] = palette[i][0]; plte[i * 3 + 1] = palette[i][1]; plte[i * 3 + 2] = palette[i][2];
        trns[i] = palette[i][3];
        if (palette[i][3] !== 255) hasTrns = true;
      }
      chunks.push(pngChunk('PLTE', plte));
      if (hasTrns) chunks.push(pngChunk('tRNS', trns));
    }
    chunks.push(pngChunk('IDAT', idat));
    chunks.push(pngChunk('IEND', new Uint8Array(0)));
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const total = sig.length + chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    out.set(sig, 0);
    let o = sig.length;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/logic.test.js`
Expected: PASS（6 个测试）

- [ ] **Step 5: Commit**

```bash
git add src/logic.js tests/logic.test.js
git commit -m "feat: PNG 编码器（rgb/rgba/palette，zlib 压缩，零依赖）"
```

---

### Task 3: 量化器 + 图像增强（TDD）

**Files:**
- Modify: `src/logic.js`
- Modify: `tests/logic.test.js`

**Interfaces:**
- Produces:
  - `quantize(rgba, maxColors) → {palette: [[r,g,b,a],...], indices: Uint8Array}`（中位切分；alpha<128 的像素并入单一透明色表项；maxColors≥2）
  - `unsharpMask(rgba, w, h, radius=1, amount=0.6) → rgba`（就地，两遍盒式模糊近似高斯 + 反锐化）
  - `autoContrast(rgba, w, h, lowPct=0.02, highPct=0.98) → rgba`（亮度直方图百分位拉伸；范围 <16 时不变）

- [ ] **Step 1: 写失败测试**（追加）

```js
// ---------- 中位切分量化 ----------
test('quantize: 颜色数不超过上限', () => {
  const w = 64, h = 64;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba[i] = (x * 4) % 256; rgba[i + 1] = (y * 4) % 256; rgba[i + 2] = (x * y) % 256; rgba[i + 3] = 255;
  }
  const { palette, indices } = PI.quantize(rgba, 16);
  assert.ok(palette.length <= 16);
  for (const v of indices) assert.ok(v < palette.length);
});

test('quantize: 全透明图 → 单透明表项', () => {
  const rgba = new Uint8ClampedArray(16 * 16 * 4).fill(0);
  const { palette, indices } = PI.quantize(rgba, 4);
  assert.strictEqual(palette.length, 1);
  assert.strictEqual(palette[0][3], 0);
  assert.ok(indices.every((v) => v === 0));
});

test('quantize: 双色图收敛到 2 色', () => {
  const w = 4, h = 4;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = i % 2 === 0 ? 255 : 0;
    rgba[i * 4 + 1] = i % 2 === 0 ? 0 : 255;
    rgba[i * 4 + 2] = 0; rgba[i * 4 + 3] = 255;
  }
  const { palette, indices } = PI.quantize(rgba, 8);
  assert.strictEqual(palette.length, 2);
  assert.deepStrictEqual(indices[0], indices[2]); // 偶数像素同色
  assert.notStrictEqual(indices[0], indices[1]);
});

// ---------- 增强 ----------
test('unsharpMask: 平坦图保持不变', () => {
  const rgba = new Uint8ClampedArray(8 * 8 * 4).fill(255);
  const before = Array.from(rgba);
  PI.unsharpMask(rgba, 8, 8, 1, 0.6);
  assert.deepStrictEqual(Array.from(rgba), before);
});

test('unsharpMask: 模糊图经处理后更锐利（方差增大）', () => {
  const w = 16, h = 16;
  const rgba = new Uint8ClampedArray(w * h * 4);
  // 构造硬边
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = x < 8 ? 40 : 200;
    rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = 255;
  }
  // 先做 3x3 盒式模糊模拟低清，再反锐化
  const tmp = new Uint8ClampedArray(rgba);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < w && yy >= 0 && yy < h) { s += tmp[(yy * w + xx) * 4]; n++; }
    }
    rgba[(y * w + x) * 4] = Math.round(s / n);
    rgba[(y * w + x) * 4 + 1] = Math.round(s / n);
    rgba[(y * w + x) * 4 + 2] = Math.round(s / n);
  }
  const variance = (arr) => { const m = arr.reduce((a, b) => a + b, 0) / arr.length; return arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length; };
  const beforeVar = variance(Array.from(rgba).filter((_, i) => i % 4 === 0));
  PI.unsharpMask(rgba, w, h, 1, 0.6);
  const afterVar = variance(Array.from(rgba).filter((_, i) => i % 4 === 0));
  assert.ok(afterVar > beforeVar, `方差应增大: ${beforeVar} -> ${afterVar}`);
});

test('autoContrast: 压缩直方图被拉伸', () => {
  const w = 16, h = 16;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = 80 + (i % 70); rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255; }
  PI.autoContrast(rgba, w, h, 0.02, 0.98);
  let min = 255, max = 0;
  for (let i = 0; i < w * h * 4; i += 4) { min = Math.min(min, rgba[i]); max = Math.max(max, rgba[i]); }
  assert.ok(min <= 20, `min=${min}`);
  assert.ok(max >= 235, `max=${max}`);
});

test('autoContrast: 反差已足够时不变', () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  const before = Array.from(rgba);
  PI.autoContrast(rgba, 2, 1, 0.02, 0.98);
  assert.deepStrictEqual(Array.from(rgba), before);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/logic.test.js`
Expected: FAIL（`quantize is not a function`）

- [ ] **Step 3: 实现**（追加；`return { ... }` 增补 `quantize, unsharpMask, autoContrast`）

```js
  // ---------- 中位切分量化 ----------
  function quantize(rgba, maxColors) {
    const n = rgba.length / 4;
    const transparent = [];
    const opaque = [];
    for (let i = 0; i < n; i++) {
      if (rgba[i * 4 + 3] < 128) transparent.push(i);
      else opaque.push(i);
    }
    const hasAlpha = transparent.length > 0;
    const usable = hasAlpha ? Math.max(1, maxColors - 1) : maxColors;
    const boxes = [{ pix: opaque }];
    while (boxes.length < usable) {
      let bestIdx = -1, bestScore = -1;
      for (let b = 0; b < boxes.length; b++) {
        if (boxes[b].pix.length < 2) continue;
        const s = boxScore(boxes[b].pix, rgba);
        if (s > bestScore) { bestScore = s; bestIdx = b; }
      }
      if (bestIdx === -1) break;
      const box = boxes[bestIdx];
      const chan = dominantChannel(box.pix, rgba);
      box.pix.sort((a, b) => rgba[a * 4 + chan] - rgba[b * 4 + chan]);
      const mid = Math.floor(box.pix.length / 2);
      boxes[bestIdx] = { pix: box.pix.slice(0, mid) };
      boxes.push({ pix: box.pix.slice(mid) });
    }
    const palette = [];
    const indices = new Uint8Array(n);
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b];
      let r = 0, g = 0, bl = 0;
      for (const i of box.pix) { r += rgba[i * 4]; g += rgba[i * 4 + 1]; bl += rgba[i * 4 + 2]; }
      const k = Math.max(1, box.pix.length);
      palette.push([Math.round(r / k), Math.round(g / k), Math.round(bl / k), 255]);
      for (const i of box.pix) indices[i] = b;
    }
    if (hasAlpha) {
      const tIdx = palette.length;
      palette.push([0, 0, 0, 0]);
      for (const i of transparent) indices[i] = tIdx;
    }
    return { palette, indices };
  }

  function boxScore(pix, rgba) {
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (const i of pix) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      if (r < rmin) rmin = r; if (r > rmax) rmax = r;
      if (g < gmin) gmin = g; if (g > gmax) gmax = g;
      if (b < bmin) bmin = b; if (b > bmax) bmax = b;
    }
    return (rmax - rmin) + (gmax - gmin) + (bmax - bmin);
  }

  function dominantChannel(pix, rgba) {
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (const i of pix) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      if (r < rmin) rmin = r; if (r > rmax) rmax = r;
      if (g < gmin) gmin = g; if (g > gmax) gmax = g;
      if (b < bmin) bmin = b; if (b > bmax) bmax = b;
    }
    const r = rmax - rmin, g = gmax - gmin, b = bmax - bmin;
    return r >= g && r >= b ? 0 : g >= b ? 1 : 2;
  }

  // ---------- 反锐化掩模（两遍盒式模糊近似高斯 + 增强）----------
  function unsharpMask(rgba, w, h, radius = 1, amount = 0.6) {
    const n = w * h;
    const tmp = new Float32Array(n * 3);
    const blur = new Float32Array(n * 3);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
          for (let c = 0; c < 3; c++) {
            const s = rgba[(y * w + x0) * 4 + c] + rgba[i * 4 + c] + rgba[(y * w + x1) * 4 + c];
            tmp[i * 3 + c] = s / 3;
          }
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
          for (let c = 0; c < 3; c++) {
            const s = tmp[(y0 * w + x) * 3 + c] + tmp[i * 3 + c] + tmp[(y1 * w + x) * 3 + c];
            blur[i * 3 + c] = s / 3;
          }
        }
      }
    }
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        const v = rgba[i * 4 + c] + amount * (rgba[i * 4 + c] - blur[i * 3 + c]);
        rgba[i * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
    }
    return rgba;
  }

  // ---------- 自动对比度（亮度直方图百分位拉伸）----------
  function autoContrast(rgba, w, h, lowPct = 0.02, highPct = 0.98) {
    const n = w * h;
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      hist[((r * 299 + g * 587 + b * 114) / 1000) | 0]++;
    }
    const total = n;
    let lo = 0, acc = 0;
    const lowTarget = total * lowPct;
    for (; lo < 256; lo++) { acc += hist[lo]; if (acc >= lowTarget) break; }
    let hi = 255; acc = 0;
    const highTarget = total * (1 - highPct);
    for (; hi > 0; hi--) { acc += hist[hi]; if (acc >= highTarget) break; }
    if (hi - lo < 16) return rgba;
    const scale = 255 / (hi - lo);
    for (let i = 0; i < n * 4; i += 4) {
      rgba[i] = Math.max(0, Math.min(255, Math.round((rgba[i] - lo) * scale)));
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round((rgba[i + 1] - lo) * scale)));
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round((rgba[i + 2] - lo) * scale)));
    }
    return rgba;
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/logic.test.js`
Expected: PASS（12 个测试）

- [ ] **Step 5: Commit**

```bash
git add src/logic.js tests/logic.test.js
git commit -m "feat: 中位切分量化器与图像增强（unsharp/autoContrast）"
```

---

### Task 4: ZIP 生成器（TDD + Python 交叉验证）

**Files:**
- Modify: `src/logic.js`
- Modify: `tests/logic.test.js`

**Interfaces:**
- Produces: `buildZip(entries) → Promise<Uint8Array>`；`entries: [{name: string（UTF-8、'/' 分隔）, data: Uint8Array}]`；method 8（deflate，`deflate-raw`）或 0（store，压缩后更大时）；UTF-8 文件名标志 0x0800
- 依赖：`crc32`、`rawDeflate`（Task 2 内部）

- [ ] **Step 1: 写失败测试**（追加）

```js
// ---------- ZIP 生成器 ----------
function parseZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 从尾部找 EOCD（签名 0x06054b50）
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'EOCD 存在');
  const count = dv.getUint16(eocd + 10);
  const cdSize = dv.getUint32(eocd + 12);
  const cdOff = dv.getUint32(eocd + 16);
  const entries = [];
  let off = cdOff;
  for (let e = 0; e < count; e++) {
    assert.strictEqual(dv.getUint32(off), 0x02014b50, 'central header 签名');
    const flags = dv.getUint16(off + 8);
    const method = dv.getUint16(off + 10);
    const crc = dv.getUint32(off + 16);
    const csize = dv.getUint32(off + 20);
    const usize = dv.getUint32(off + 24);
    const nameLen = dv.getUint16(off + 28);
    const extraLen = dv.getUint16(off + 30);
    const commentLen = dv.getUint16(off + 32);
    const localOff = dv.getUint32(off + 42);
    const name = new TextDecoder().decode(bytes.slice(off + 46, off + 46 + nameLen));
    // 本地头
    assert.strictEqual(dv.getUint32(localOff), 0x04034b50, 'local header 签名');
    const lNameLen = dv.getUint16(localOff + 26);
    const lExtraLen = dv.getUint16(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = bytes.slice(dataStart, dataStart + csize);
    const raw = method === 8 ? zlib.inflateRawSync(comp) : comp;
    assert.strictEqual(raw.length, usize);
    assert.strictEqual(PI.crc32(raw), crc);
    entries.push({ name, method, raw, flags });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

test('buildZip: 多文件含中文名，往返一致', async () => {
  const data1 = new Uint8Array(1000).map((_, i) => (i * 7) % 256);
  const data2 = new TextEncoder().encode('中文文件名测试 - hello zip');
  const bytes = await PI.buildZip([
    { name: '照片/风景 001.jpg', data: data1 },
    { name: '测试文本.txt', data: data2 },
  ]);
  const entries = parseZip(bytes);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].name, '照片/风景 001.jpg');
  assert.ok(entries[0].flags & 0x0800, 'UTF-8 标志');
  assert.deepStrictEqual(Array.from(entries[0].raw), Array.from(data1));
  assert.deepStrictEqual(Array.from(entries[1].raw), Array.from(data2));
  // 结构完整性：local 数据 + central 目录 + EOCD 正好等于总长
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  assert.strictEqual(dv.getUint32(eocd), 0x06054b50);
  assert.strictEqual(dv.getUint32(eocd + 12) + dv.getUint32(eocd + 16) + 22, bytes.length);
});

test('buildZip: 不可压缩数据退化为 store', async () => {
  const data = new Uint8Array(2048).map((_, i) => i % 251); // 伪随机，难压缩
  const bytes = await PI.buildZip([{ name: 'rand.bin', data }]);
  const entries = parseZip(bytes);
  assert.strictEqual(entries.length, 1);
  assert.deepStrictEqual(Array.from(entries[0].raw), Array.from(data));
});

test('buildZip: 用系统 Python 交叉验证', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const out = new TextEncoder().encode('python 验证内容');
  return (async () => {
    const zip = await PI.buildZip([{ name: 'py/验证.txt', data: out }]);
    fs.mkdirSync('tests/out', { recursive: true });
    fs.writeFileSync('tests/out/cross.zip', zip);
    const py = spawnSync('python', ['-c',
      'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read("py/验证.txt").decode()=="python 验证内容"; print("PYZIP_OK")',
      'tests/out/cross.zip'], { encoding: 'utf8' });
    assert.strictEqual(py.status, 0, `python 输出: ${py.stdout}${py.stderr}`);
    assert.match(py.stdout, /PYZIP_OK/);
  })();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/logic.test.js`
Expected: FAIL（`buildZip is not a function`）

- [ ] **Step 3: 实现**（追加；`return { ... }` 增补 `buildZip`）

```js
  // ---------- ZIP 生成器（local header + raw deflate + central dir + EOCD）----------
  async function buildZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const e of entries) {
      const nameBytes = encoder.encode(e.name);
      const compressed = await rawDeflate(e.data);
      const useStore = compressed.length >= e.data.length;
      const dataBytes = useStore ? e.data : compressed;
      const method = useStore ? 0 : 8;
      const crc = crc32(e.data);
      const size = e.data.length, csize = dataBytes.length;
      const lh = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true); // UTF-8 文件名
      dv.setUint16(8, method, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, csize, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      const body = new Uint8Array(30 + nameBytes.length + dataBytes.length);
      body.set(lh, 0); body.set(dataBytes, 30 + nameBytes.length);
      localParts.push(body);
      const ch = new Uint8Array(46 + nameBytes.length);
      const dv2 = new DataView(ch.buffer);
      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true);
      dv2.setUint16(6, 20, true);
      dv2.setUint16(8, 0x0800, true);
      dv2.setUint16(10, method, true);
      dv2.setUint16(12, 0, true);
      dv2.setUint16(14, 0, true);
      dv2.setUint32(16, crc, true);
      dv2.setUint32(20, csize, true);
      dv2.setUint32(24, size, true);
      dv2.setUint16(28, nameBytes.length, true);
      dv2.setUint16(30, 0, true);
      dv2.setUint16(32, 0, true);
      dv2.setUint16(34, 0, true);
      dv2.setUint16(36, 0, true);
      dv2.setUint32(38, 0, true);
      dv2.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      centralParts.push(ch);
      offset += body.length;
    }
    const centralSize = centralParts.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const dv3 = new DataView(eocd.buffer);
    dv3.setUint32(0, 0x06054b50, true);
    dv3.setUint16(4, 0, true);
    dv3.setUint16(6, 0, true);
    dv3.setUint16(8, entries.length, true);
    dv3.setUint16(10, entries.length, true);
    dv3.setUint32(12, centralSize, true);
    dv3.setUint32(16, offset, true);
    dv3.setUint16(20, 0, true);
    const total = offset + centralSize + 22;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of localParts) { out.set(p, o); o += p.length; }
    for (const p of centralParts) { out.set(p, o); o += p.length; }
    out.set(eocd, o);
    return out;
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/logic.test.js`
Expected: PASS（16 个测试，含 Python 交叉验证 `PYZIP_OK`）

- [ ] **Step 5: Commit**

```bash
git add src/logic.js tests/logic.test.js
git commit -m "feat: ZIP 生成器（UTF-8 文件名、deflate/store 自适应、Python 交叉验证）"
```

---

### Task 5: 测试夹具生成器（用自有编码器生成 E2E 图片）

**Files:**
- Create: `tools/gen-fixtures.js`
- Create: `tests/fixtures/.gitkeep`

**Interfaces:**
- Produces: `tests/fixtures/*.png`（大图 3000×2000、小图 100×80、超高 2000×4000、超宽 4000×1500、纯色 2400×1600、低对比 64×48、带透明通道 800×600）
- 依赖：`encodePng`（Task 2）

- [ ] **Step 1: 写生成器**（确定性：种子随机数）

```js
'use strict';
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
  const bytes = await PI.encodePng({ width: w, height: h, rgba, mode: rgba.length === w * h * 4 ? 'rgba' : 'rgb' });
  fs.writeFileSync(path.join(__dirname, '..', 'tests', 'fixtures', name), bytes);
  console.log(`${name}: ${w}x${h}, ${(bytes.length / 1024).toFixed(1)} KB`);
}

(async () => {
  const r = rng(20260811);
  const noise = () => Math.floor(r() * 18);

  // 1. 大图：天空渐变 + 噪点 + 云团（照片感）
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

  // 5. 纯色（简单内容：JPEG 在最高质量下仍小于目标）
  await writePng('solid.png', 2400, 1600, makeImage(2400, 1600, () => [189, 147, 249, 255]));

  // 6. 低对比小图（触发增强）
  await writePng('lowcontrast.png', 64, 48, makeImage(64, 48, () => {
    const v = 120 + Math.floor(r() * 20);
    return [v, v, v, 255];
  }));

  // 7. 带透明通道
  await writePng('withalpha.png', 800, 600, makeImage(800, 600, (x, y) => {
    const c = Math.round(255 * (x / 800));
    return x < 400 ? [c, 255 - c, 128, 200] : [c, 255 - c, 128, 255];
  }));
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 运行并验证**

Run: `node tools/gen-fixtures.js`
Expected: 7 个 PNG 生成，输出尺寸/大小日志正常

- [ ] **Step 3: 用自有解析器反向验证夹具可解码**

```bash
node -e "const PI=require('./src/logic.js');const z=require('node:zlib');const fs=require('node:fs');for(const f of fs.readdirSync('tests/fixtures')){if(!f.endsWith('.png'))continue;const b=fs.readFileSync('tests/fixtures/'+f);console.log(f,'sig ok:',b[0]===0x89&&b[1]===0x50,'size:',b.length)}"
```

Expected: 全部 sig ok

- [ ] **Step 4: Commit**

```bash
git add tools/gen-fixtures.js tests/fixtures/
git commit -m "test: 确定性测试夹具（大/小/超高/超宽/纯色/低对比/透明）"
```

---

### Task 6: UI 模板 + 样式（模板含内联标记）

**Files:**
- Create: `src/index.template.html`
- Create: `src/style.css`

**Interfaces:**
- Produces: 模板含标记 `<!--STYLE-->`、`<!--LOGIC-->`、`<!--APP-->`（build.js 替换）；UI 元素 id 契约（供 Task 7-9 使用）：
  `fileInput`（多选文件）、`folderInput`（webkitdirectory）、`dropZone`、`settingsPanel`（details）、`targetKB`、`maxEdge`、`aspectSelect`、`customAspect`、`formatSelect`、`enhanceToggle`、`tolerance`、`fileList`、`statsBar`、`progressFill`、`btnConvert`、`btnCancel`、`btnExportZip`、`btnClearDone`、`btnClearAll`、`listEmpty`

- [ ] **Step 1: 写 HTML 模板**（`src/index.template.html`）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="description" content="本地批量图片转换：统一大小与比例，无网络">
<title>图片批量转换 · 统一大小</title>
<!--STYLE-->
</head>
<body>
<header class="topbar">
  <h1>图片批量转换</h1>
  <span class="local-badge">纯本地 · 零联网</span>
</header>

<main>
  <!-- 导入区 -->
  <section id="dropZone" tabindex="0" role="button" aria-label="拖入图片或文件夹">
    <div class="drop-icon">⬆</div>
    <p class="drop-title">拖入图片或文件夹到此处</p>
    <p class="drop-sub">或点击下方按钮选择 · 支持整文件夹（含子文件夹）</p>
    <div class="drop-actions">
      <button type="button" class="btn primary" id="btnPickFiles">选择图片</button>
      <button type="button" class="btn" id="btnPickFolder">选择文件夹</button>
    </div>
    <input type="file" id="fileInput" multiple accept="image/*" hidden>
    <input type="file" id="folderInput" webkitdirectory multiple hidden>
  </section>

  <!-- 设置 -->
  <details id="settingsPanel" open>
    <summary>输出设置</summary>
    <div class="settings-grid">
      <label class="field">目标大小
        <input type="number" id="targetKB" min="5" max="5120" step="1" value="50">
        <span class="unit">KB</span>
      </label>
      <label class="field">输出比例
        <select id="aspectSelect">
          <option value="1:1">1:1 正方形</option>
          <option value="4:3">4:3</option>
          <option value="3:2">3:2</option>
          <option value="16:9">16:9</option>
          <option value="custom">自定义</option>
        </select>
      </label>
      <label class="field custom-aspect" id="customAspectWrap" hidden>
        <input type="text" id="customAspect" placeholder="如 5:4" value="5:4">
      </label>
      <label class="field">最长边
        <input type="number" id="maxEdge" min="32" max="2048" step="1" value="240">
        <span class="unit">px</span>
      </label>
      <label class="field">输出格式
        <select id="formatSelect">
          <option value="auto">保持原格式</option>
          <option value="jpeg">JPEG（.jpg）</option>
          <option value="jpg">JPG（.jpg）</option>
          <option value="png">PNG（.png）</option>
        </select>
      </label>
      <label class="field">容差
        <input type="number" id="tolerance" min="1" max="10" step="1" value="2">
        <span class="unit">%</span>
      </label>
      <label class="field check"><input type="checkbox" id="enhanceToggle" checked> 增强低清晰度图像（上采样 + 锐化 + 对比度）</label>
    </div>
    <p class="hint">裁剪规则：过宽图居中裁左右；过高图按 3:7 裁上下（上 30% / 下 70%）。JPEG 精确命中目标大小；PNG 为无损格式，结果 ≤ 目标大小×容差。</p>
  </details>

  <!-- 列表 -->
  <section id="listSection">
    <div id="listEmpty" class="empty">尚未导入图片 — 拖入、选择图片或选择文件夹</div>
    <ul id="fileList" class="file-list"></ul>
  </section>

  <!-- 底部操作栏 -->
  <section class="actionbar" id="actionbar">
    <div class="stats" id="statsBar">0 张图片</div>
    <div class="progress-wrap"><div class="progress-fill" id="progressFill"></div></div>
    <div class="actions">
      <button type="button" class="btn primary" id="btnConvert">开始转换</button>
      <button type="button" class="btn" id="btnCancel" disabled>取消</button>
      <button type="button" class="btn accent" id="btnExportZip" disabled>下载 ZIP</button>
      <button type="button" class="btn ghost" id="btnClearDone" disabled>移除已完成</button>
      <button type="button" class="btn ghost" id="btnClearAll" disabled>全部清除</button>
    </div>
  </section>
</main>

<footer class="footer">
  纯本地运行 · 图片不会上传到任何服务器 · 无网络请求 · 支持 Windows / Linux / Android
</footer>

<script><!--LOGIC--></script>
<script><!--APP--></script>
</body>
</html>
```

- [ ] **Step 2: 写样式**（`src/style.css`，完整覆盖浅/暗色与移动端）

```css
:root {
  --bg: #f4f6f8; --card: #ffffff; --text: #1b2733; --muted: #64748b;
  --border: #dbe2ea; --primary: #2f6fed; --primary-text: #ffffff;
  --accent: #16a34a; --danger: #dc2626; --shadow: 0 1px 3px rgba(16, 24, 40, .08);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1419; --card: #1a222b; --text: #e7edf3; --muted: #8fa3b8;
    --border: #2c3a47; --primary: #4c8dff; --primary-text: #ffffff;
    --accent: #22c55e; --danger: #f87171; --shadow: 0 1px 3px rgba(0, 0, 0, .5);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg); color: var(--text);
  font: 15px/1.5 system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-tap-highlight-color: transparent;
}
.topbar { max-width: 780px; margin: 0 auto; padding: 18px 16px 6px; display: flex; align-items: center; gap: 10px; }
.topbar h1 { font-size: 20px; margin: 0; }
.local-badge { font-size: 12px; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 2px 10px; }
main { max-width: 780px; margin: 0 auto; padding: 10px 16px 90px; display: flex; flex-direction: column; gap: 14px; }

#dropZone {
  border: 2px dashed var(--border); border-radius: 14px; background: var(--card);
  padding: 28px 16px; text-align: center; cursor: pointer; transition: border-color .15s, background .15s;
}
#dropZone.drag, #dropZone:focus-visible { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 6%, var(--card)); outline: none; }
.drop-icon { font-size: 30px; opacity: .7; }
.drop-title { margin: 6px 0 2px; font-weight: 600; }
.drop-sub { margin: 0 0 14px; font-size: 13px; color: var(--muted); }
.drop-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }

.btn {
  border: 1px solid var(--border); background: var(--card); color: var(--text);
  border-radius: 10px; padding: 10px 18px; font-size: 15px; cursor: pointer;
  min-height: 44px; touch-action: manipulation; transition: filter .12s;
}
.btn:active { filter: brightness(.94); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-text); }
.btn.accent { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.ghost { background: transparent; }
@media (max-width: 560px) { .btn { flex: 1; } }

details#settingsPanel { background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); }
details#settingsPanel summary { cursor: pointer; padding: 12px 16px; font-weight: 600; user-select: none; }
.settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; padding: 4px 16px 14px; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
.field input[type="number"], .field input[type="text"], .field select {
  font-size: 15px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg); color: var(--text); min-height: 42px; width: 100%;
}
.field .unit { font-size: 12px; color: var(--muted); }
.field.check { flex-direction: row; align-items: center; gap: 8px; font-size: 14px; color: var(--text); }
.field.check input { width: 18px; height: 18px; }
.hint { margin: 0; padding: 0 16px 14px; font-size: 12.5px; color: var(--muted); }

.empty { text-align: center; color: var(--muted); padding: 26px 10px; font-size: 14px; }
.file-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.file-row {
  display: flex; align-items: center; gap: 12px; background: var(--card);
  border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; box-shadow: var(--shadow);
}
.file-row .thumb {
  width: 48px; height: 48px; object-fit: cover; border-radius: 8px;
  background: repeating-conic-gradient(#e5e9ef 0 25%, #fff 0 50%) 0 0/12px 12px; flex: none;
}
.file-row .info { flex: 1; min-width: 0; }
.file-row .name { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-row .meta { font-size: 12px; color: var(--muted); }
.file-row .result { font-size: 12px; white-space: nowrap; }
.file-row .status { font-size: 12px; font-weight: 600; white-space: nowrap; }
.file-row .status.waiting { color: var(--muted); }
.file-row .status.processing { color: var(--primary); }
.file-row .status.done { color: var(--accent); }
.file-row .status.error { color: var(--danger); }
.file-row .row-actions { display: flex; gap: 8px; flex: none; }
.icon-btn { border: 1px solid var(--border); background: var(--card); color: var(--text); border-radius: 8px; padding: 8px 10px; font-size: 13px; cursor: pointer; min-height: 40px; }
.icon-btn:disabled { opacity: .4; cursor: not-allowed; }

.actionbar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
  background: color-mix(in srgb, var(--card) 92%, transparent); backdrop-filter: blur(8px);
  border-top: 1px solid var(--border); padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
}
.actionbar .actions { display: flex; gap: 8px; flex-wrap: wrap; }
.stats { font-size: 13px; color: var(--muted); margin-bottom: 8px; }
.progress-wrap { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
.progress-fill { height: 100%; width: 0%; background: var(--primary); border-radius: 3px; transition: width .15s; }

.footer { max-width: 780px; margin: 0 auto; padding: 14px 16px 100px; font-size: 12px; color: var(--muted); text-align: center; }
@media (min-width: 561px) {
  main { padding-bottom: 120px; }
  .footer { padding-bottom: 20px; }
  .actionbar .actions { justify-content: flex-end; }
}
```

说明：`src/style.css` 只含上述 CSS 内容，**不含** `<style>` 标签（build.js 负责包裹）。

- [ ] **Step 3: Commit**

```bash
git add src/index.template.html src/style.css
git commit -m "feat: UI 模板与响应式样式（浅/暗色、移动端粘性操作栏）"
```

---

### Task 7: app.js — 导入、列表与设置（TDD 不适用，浏览器手测）

**Files:**
- Create: `src/app.js`

**Interfaces:**
- Consumes: `PI`（logic.js 全量）、Task 6 的 DOM id 契约
- Produces: `state.items` 每项 `{id, file, relPath, name, origSize, status, error, resultBlob, resultSize, outName, thumbUrl}`；函数 `addFiles(files)`、`addDirectoryEntries(entries)`、`renderList()`、`renderRow(item)`、`updateStats()`、`loadSettings()`/`saveSettings()`、`currentSettings()`

- [ ] **Step 1: 写 app.js 第一部分**（导入/列表/设置；管线 Task 8 追加）

```js
'use strict';
/* 浏览器端：UI 与处理管线。依赖 window.PI（logic.js） */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);

  const state = {
    items: [],
    settings: { targetKB: 50, maxEdge: 240, aspect: '1:1', customAspect: '5:4', format: 'auto', enhance: true, tolerance: 2 },
    converting: false,
    cancel: false,
    nextId: 1,
  };
  const SETTINGS_KEY = 'pi-settings-v1';
  const IMAGE_RE = /\.(jpe?g|png|webp|bmp|gif|avif|svg)$/i;
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));

  // ---------- 设置 ----------
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (s) Object.assign(state.settings, s);
    } catch (e) { /* 忽略 */ }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) { /* 忽略 */ }
  }
  function aspectRatio() {
    const s = state.settings;
    if (s.aspect === 'custom') {
      const m = /^(\d+)\s*:\s*(\d+)$/.exec(s.customAspect);
      if (!m) return [1, 1];
      return [parseInt(m[1], 10), parseInt(m[2], 10)];
    }
    const [w, h] = s.aspect.split(':').map(Number);
    return [w || 1, h || 1];
  }
  function currentSettings() {
    const s = state.settings;
    return {
      targetBytes: Math.max(1, Math.round(s.targetKB * 1024)),
      maxEdge: Math.max(32, Math.min(2048, Math.round(s.maxEdge))),
      aspect: aspectRatio(),
      format: s.format,
      enhance: !!s.enhance,
      tolerance: Math.max(0.5, Math.min(15, s.tolerance)) / 100,
    };
  }

  // ---------- 导入 ----------
  function isImageFile(f) { return IMAGE_RE.test(f.name); }

  function addFiles(files, baseRel = '') {
    for (const f of files) {
      if (!isImageFile(f)) continue;
      pushItem(f, baseRel ? baseRel + f.name : f.name);
    }
    refresh();
  }

  function pushItem(file, relPath) {
    const name = relPath.split('/').pop();
    state.items.push({
      id: state.nextId++,
      file, relPath, name,
      origSize: file.size,
      status: 'waiting', error: '',
      resultBlob: null, resultSize: 0, outName: '',
      thumbUrl: '',
    });
  }

  function readAllEntries(dir) {
    return new Promise((resolve) => {
      const reader = dir.createReader();
      const all = [];
      (function readBatch() {
        reader.readEntries((entries) => {
          if (entries.length === 0) return resolve(all);
          all.push(...entries);
          readBatch();
        }, () => resolve(all));
      })();
    });
  }

  async function addDirectoryEntries(entries, baseRel = '') {
    for (const entry of entries) {
      if (entry.isFile) {
        const f = await new Promise((res) => entry.file(res, () => res(null)));
        if (f && isImageFile(f)) pushItem(f, baseRel + f.name);
      } else if (entry.isDirectory) {
        const children = await readAllEntries(entry);
        await addDirectoryEntries(children, baseRel + entry.name + '/');
      }
    }
  }

  function bindImport() {
    $('#btnPickFiles').addEventListener('click', () => $('#fileInput').click());
    $('#btnPickFolder').addEventListener('click', () => $('#folderInput').click());
    // 点击拖放区等同「选择图片」
    $('#dropZone').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
    // 文件夹输入：每个文件自带 webkitRelativePath（如 相册/a.jpg）
    $('#folderInput').addEventListener('change', (e) => {
      const files = Array.from(e.target.files).filter(isImageFile);
      for (const f of files) pushItem(f, f.webkitRelativePath || f.name);
      refresh();
      e.target.value = '';
    });
    const dz = $('#dropZone');
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', async (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
      const entries = [];
      for (const it of e.dataTransfer.items) {
        if (it.webkitGetAsEntry) { const en = it.webkitGetAsEntry(); if (en) entries.push(en); }
      }
      if (entries.length) await addDirectoryEntries(entries);
      else addFiles(e.dataTransfer.files);
    });
  }
```

- [ ] **Step 2: 写列表渲染与统计**（追加到 app.js）

```js
  // ---------- 列表渲染 ----------
  function refresh() {
    renderList();
    updateStats();
    updateButtons();
  }

  function renderList() {
    const list = $('#fileList');
    list.textContent = '';
    $('#listEmpty').hidden = state.items.length > 0;
    for (const item of state.items) list.appendChild(renderRow(item));
  }

  function renderRow(item) {
    const li = document.createElement('li');
    li.className = 'file-row';
    li.dataset.id = item.id;

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.alt = '';
    if (item.thumbUrl) thumb.src = item.thumbUrl;
    else {
      item.thumbUrl = URL.createObjectURL(item.file);
      thumb.src = item.thumbUrl;
    }

    const info = document.createElement('div');
    info.className = 'info';
    const nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = item.name;
    nameEl.title = item.relPath;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = fmtSize(item.origSize);
    info.append(nameEl, meta);

    const result = document.createElement('div');
    result.className = 'result';
    if (item.status === 'done') result.textContent = '→ ' + fmtSize(item.resultSize);
    else if (item.status === 'error') { result.textContent = '失败：' + item.error; result.style.color = 'var(--danger)'; }

    const status = document.createElement('div');
    status.className = 'status ' + item.status;
    status.textContent = statusText(item.status);

    const rowActions = document.createElement('div');
    rowActions.className = 'row-actions';
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'icon-btn';
    dl.textContent = '下载';
    dl.disabled = item.status !== 'done';
    dl.addEventListener('click', () => downloadBlob(item.resultBlob, item.outName));
    rowActions.appendChild(dl);

    li.append(thumb, info, result, status, rowActions);
    return li;
  }

  function statusText(s) {
    return { waiting: '等待', processing: '处理中…', done: '完成', error: '失败' }[s] || s;
  }

  function fmtSize(n) {
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }

  function updateStats() {
    const done = state.items.filter((i) => i.status === 'done').length;
    const failed = state.items.filter((i) => i.status === 'error').length;
    $('#statsBar').textContent = `${state.items.length} 张 · 完成 ${done} · 失败 ${failed}`;
    const total = state.items.length;
    $('#progressFill').style.width = (total ? (done + failed) / total * 100 : 0) + '%';
  }

  function updateButtons() {
    const has = state.items.length > 0;
    const hasDone = state.items.some((i) => i.status === 'done');
    $('#btnConvert').disabled = state.converting || !has;
    $('#btnCancel').disabled = !state.converting;
    $('#btnExportZip').disabled = !hasDone || state.converting;
    $('#btnClearDone').disabled = !hasDone;
    $('#btnClearAll').disabled = !has;
  }

  function removeItems(pred) {
    for (const item of state.items) if (pred(item)) revokeItem(item);
    state.items = state.items.filter((i) => !pred(i));
    refresh();
  }
  function revokeItem(item) {
    if (item.thumbUrl) { URL.revokeObjectURL(item.thumbUrl); item.thumbUrl = ''; }
    if (item.resultBlob) item.resultBlob = null;
  }
```

- [ ] **Step 3: 写设置渲染与绑定 + 下载工具**（追加）

```js
  // ---------- 设置 UI ----------
  function renderSettings() {
    const s = state.settings;
    $('#targetKB').value = s.targetKB;
    $('#maxEdge').value = s.maxEdge;
    $('#aspectSelect').value = s.aspect;
    $('#customAspect').value = s.customAspect;
    $('#customAspectWrap').hidden = s.aspect !== 'custom';
    $('#formatSelect').value = s.format;
    $('#tolerance').value = s.tolerance;
    $('#enhanceToggle').checked = s.enhance;
  }
  function bindSettings() {
    const set = (key, val) => { state.settings[key] = val; saveSettings(); };
    $('#targetKB').addEventListener('change', (e) => set('targetKB', clampNum(e.target.value, 5, 5120, 50)));
    $('#maxEdge').addEventListener('change', (e) => set('maxEdge', clampNum(e.target.value, 32, 2048, 240)));
    $('#aspectSelect').addEventListener('change', (e) => {
      set('aspect', e.target.value);
      $('#customAspectWrap').hidden = e.target.value !== 'custom';
    });
    $('#customAspect').addEventListener('change', (e) => set('customAspect', e.target.value.trim()));
    $('#formatSelect').addEventListener('change', (e) => set('format', e.target.value));
    $('#tolerance').addEventListener('change', (e) => set('tolerance', clampNum(e.target.value, 1, 10, 2)));
    $('#enhanceToggle').addEventListener('change', (e) => set('enhance', e.target.checked));
  }
  function clampNum(v, min, max, fallback) {
    const n = parseFloat(v);
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  // ---------- 下载 ----------
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // 暴露给 Task 8 的内部接口
  window.__pi = { state, currentSettings, downloadBlob, yieldUI };
```

- [ ] **Step 4: 手测导入/设置**（浏览器）

Run: `node build.js` 之前先临时用占位替换 —— 本步用静态预览：

```bash
cp src/index.template.html /tmp/pi-preview.html
# 手动把 <!--STYLE--> 换成 <style>+style.css 内容、<!--LOGIC/APP--> 换成空，或直接等 Task 9 的 build.js
```

简化：本任务结束后先写 Task 9 的 build.js 再做浏览器手测（见 Task 9 Step 1）。此处只需保证 `node --check src/app.js` 通过。

- [ ] **Step 5: 语法检查**

Run: `node --check src/app.js`
Expected: 无输出（语法 OK）

- [ ] **Step 6: Commit**

```bash
git add src/app.js
git commit -m "feat: 导入（文件/文件夹/拖拽）、列表渲染、设置持久化"
```

---

### Task 8: app.js — 处理管线（裁剪 3:7 → 缩放 → 增强 → 目标大小编码）

**Files:**
- Modify: `src/app.js`（在 `window.__pi` 之前追加）

**Interfaces:**
- Consumes: `PI.encodePng/PI.quantize/PI.unsharpMask/PI.autoContrast`、`currentSettings()`、`window.__pi.yieldUI`
- Produces: `window.__pi.convertAll()`（顺序处理，每张后让出主线程）、`window.__pi.convertOne(item)`；`item.resultBlob/resultSize/outName` 就绪

- [ ] **Step 1: 写解码/裁剪/缩放工具**（追加）

```js
  // ---------- 解码 ----------
  async function loadBitmap(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        return img;
      } finally { URL.revokeObjectURL(url); }
    }
  }
  function srcDims(src) {
    const w = src.naturalWidth || src.width;
    const h = src.naturalHeight || src.height;
    return { w, h };
  }

  // 比例归一：过宽居中裁左右；过高按 3:7 裁上下（上 30% / 下 70%）
  function computeCrop(srcW, srcH, [aW, aH]) {
    let w = srcW, h = srcH, x = 0, y = 0;
    const srcRatio = srcW / srcH;
    const targetRatio = aW / aH;
    if (srcRatio > targetRatio) {
      w = Math.round(srcH * targetRatio);
      x = Math.round((srcW - w) / 2);
    } else if (srcRatio < targetRatio) {
      h = Math.round(srcW / targetRatio);
      y = Math.round((srcH - h) * 0.3);
    }
    return { x, y, w, h };
  }

  function outputDims(maxEdge, [aW, aH]) {
    if (aW >= aH) return { w: maxEdge, h: Math.round(maxEdge * aH / aW) };
    return { w: Math.round(maxEdge * aW / aH), h: maxEdge };
  }

  function drawCanvas(src, sx, sy, sw, sh, dw, dh) {
    const canvas = document.createElement('canvas');
    canvas.width = dw; canvas.height = dh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
    return canvas;
  }

  function scaleCanvasByEdge(canvas, edge) {
    const w = canvas.width, h = canvas.height;
    let dw, dh;
    if (w >= h) { dw = edge; dh = Math.max(1, Math.round(edge * h / w)); }
    else { dh = edge; dw = Math.max(1, Math.round(edge * w / h)); }
    if (dw === w && dh === h) return canvas;
    return drawCanvas(canvas, 0, 0, w, h, dw, dh);
  }

  function enhanceCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const img = ctx.getImageData(0, 0, width, height);
    PI.unsharpMask(img.data, width, height, 1, 0.6);
    PI.autoContrast(img.data, width, height, 0.02, 0.98);
    ctx.putImageData(img, 0, 0);
  }
```

- [ ] **Step 2: 写目标大小编码**（JPEG 二分 + PNG 逐级压缩，追加）

```js
  // ---------- 编码到目标大小 ----------
  function toBlobJpeg(canvas, q) {
    return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', q / 100));
  }

  // JPEG：质量二分命中 [target*(1-tol), target*(1+tol)]；q=30 仍大则降分辨率（-12%/轮，下限 64）
  async function jpegToTarget(canvas, targetBytes, tolerance, maxEdge) {
    let cur = canvas;
    let edge = maxEdge;
    let best = null;
    let bestDiff = Infinity;
    for (;;) {
      let lo = 30, hi = 95;
      for (let i = 0; i < 10; i++) {
        const q = Math.round((lo + hi) / 2);
        const blob = await toBlobJpeg(cur, q);
        const diff = Math.abs(blob.size - targetBytes);
        if (diff < bestDiff) { bestDiff = diff; best = { blob, q, edge }; }
        const low = targetBytes * (1 - tolerance);
        const high = targetBytes * (1 + tolerance);
        if (blob.size < low) lo = q + 1;
        else if (blob.size > high) hi = q - 1;
        else return { blob, q, edge };
      }
      if (edge <= 64) break;
      edge = Math.round(edge * 0.88);
      cur = scaleCanvasByEdge(canvas, edge);
    }
    return best;
  }

  // PNG：直通 RGB/RGBA → 调色板量化（256→128→64→32→16→8→4）→ 降分辨率；无损，≤ target*(1+tol)
  async function pngToTarget(canvas, targetBytes, tolerance, maxEdge) {
    const limit = targetBytes * (1 + tolerance);
    const colorSteps = [256, 128, 64, 32, 16, 8, 4];
    const getData = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    let data = getData(canvas);
    let hasAlpha = false;
    for (let i = 3; i < data.data.length; i += 4) {
      if (data.data[i] !== 255) { hasAlpha = true; break; }
    }
    const direct = await PI.encodePng({ width: data.width, height: data.height, rgba: data.data, mode: hasAlpha ? 'rgba' : 'rgb' });
    if (direct.length <= limit) return new Blob([direct], { type: 'image/png' });
    let lastBytes = direct;
    for (const colors of colorSteps) {
      const q = PI.quantize(data.data, colors);
      lastBytes = await PI.encodePng({ width: data.width, height: data.height, indices: q.indices, palette: q.palette, mode: 'palette' });
      if (lastBytes.length <= limit) return new Blob([lastBytes], { type: 'image/png' });
    }
    let edge = Math.min(data.width, data.height, maxEdge);
    while (edge > 48) {
      edge = Math.round(edge * 0.8);
      const scaled = scaleCanvasByEdge(canvas, edge);
      data = getData(scaled);
      for (const colors of colorSteps) {
        const q = PI.quantize(data.data, colors);
        lastBytes = await PI.encodePng({ width: data.width, height: data.height, indices: q.indices, palette: q.palette, mode: 'palette' });
        if (lastBytes.length <= limit) return new Blob([lastBytes], { type: 'image/png' });
      }
    }
    return new Blob([lastBytes], { type: 'image/png' });
  }
```

- [ ] **Step 3: 写转换主流程**（追加）

```js
  // ---------- 转换主流程 ----------
  function extFor(settings, srcName) {
    if (settings.format === 'png') return 'png';
    if (settings.format === 'jpg') return 'jpg';
    if (settings.format === 'jpeg') return 'jpeg';
    return /\.png$/i.test(srcName) ? 'png' : 'jpg'; // auto：png 保留，其余转 jpg
  }

  async function convertOne(item) {
    const s = currentSettings();
    const src = await loadBitmap(item.file);
    const { w: sw, h: sh } = srcDims(src);
    const crop = computeCrop(sw, sh, s.aspect);
    const out = outputDims(s.maxEdge, s.aspect);
    let canvas = drawCanvas(src, crop.x, crop.y, crop.w, crop.h, out.w, out.h);
    const needEnhance = s.enhance && Math.max(crop.w, crop.h) < s.maxEdge;
    if (needEnhance) enhanceCanvas(canvas);
    const ext = extFor(s, item.name);
    if (ext === 'png') {
      item.resultBlob = await pngToTarget(canvas, s.targetBytes, s.tolerance, s.maxEdge);
    } else {
      const r = await jpegToTarget(canvas, s.targetBytes, s.tolerance, s.maxEdge);
      item.resultBlob = r.blob;
      if (r.edge < s.maxEdge) item.note = `分辨率已降至 ${r.edge}px 以达到目标大小`;
    }
    item.resultSize = item.resultBlob.size;
    item.outName = item.name.replace(/\.[^.]+$/, '') + '.' + ext;
    item.status = 'done';
  }

  function friendlyError(err) {
    const m = String(err && err.message || err);
    if (/decode|load|image/i.test(m)) return '无法解码（HEIC 等格式请先转换为 JPEG/PNG）';
    return m.slice(0, 120);
  }

  async function convertAll() {
    if (state.converting) return;
    state.converting = true;
    state.cancel = false;
    const pending = state.items.filter((i) => i.status === 'waiting' || i.status === 'error');
    for (const item of pending) {
      if (state.cancel) break;
      item.status = 'processing';
      item.error = '';
      item.note = '';
      renderRow(item);
      await window.__pi.yieldUI();
      try {
        await convertOne(item);
      } catch (err) {
        item.status = 'error';
        item.error = friendlyError(err);
      }
      renderRow(item);
      updateStats();
      updateButtons();
    }
    state.converting = false;
    updateStats();
    updateButtons();
  }
```

注意：`renderRow` 重新创建 DOM 节点会覆盖行内事件绑定——`renderRow` 在 Task 7 中每次全量重建；此处在 `convertAll` 中直接调用 `renderRow(item)` 会重建该行，行内按钮事件会重新绑定（downloadBlob 绑定在行创建时），可接受。但 `renderList` 全量重建会丢滚动位置——转换中只重建单行，OK。

- [ ] **Step 4: 绑定转换/取消按钮**（追加）

```js
  // ---------- 动作绑定 ----------
  function bindActions() {
    $('#btnConvert').addEventListener('click', () => convertAll());
    $('#btnCancel').addEventListener('click', () => { state.cancel = true; });
    $('#btnClearDone').addEventListener('click', () => removeItems((i) => i.status === 'done'));
    $('#btnClearAll').addEventListener('click', () => removeItems(() => true));
    $('#btnExportZip').addEventListener('click', () => exportZip());
  }
```

（`exportZip` 在 Task 9 实现，届时把 `bindActions` 中该行接入。）

- [ ] **Step 5: 语法检查**

Run: `node --check src/app.js`
Expected: 无输出

- [ ] **Step 6: Commit**

```bash
git add src/app.js
git commit -m "feat: 处理管线（3:7 裁剪、统一比例缩放、低清增强、JPEG 二分/PNG 量化命中目标大小）"
```

---

### Task 9: 导出 + build.js 打包 + E2E 验证

**Files:**
- Modify: `src/app.js`（追加 `exportZip` + `boot()`）
- Create: `build.js`
- Create: `index.html`（build 产物）
- Create: `README.md`

**Interfaces:**
- Consumes: `PI.buildZip`、`window.__pi.downloadBlob/state`

- [ ] **Step 1: 写导出与启动**（追加到 app.js 末尾，替换原 `window.__pi` 暴露块）

```js
  // ---------- 导出 ZIP ----------
  // zip-slip 防护：去除盘符、前导斜杠、. 与 .. 片段
  function sanitizeZipName(name) {
    let n = String(name).replace(/\\/g, '/');
    n = n.replace(/^[a-zA-Z]:\//, '').replace(/^\/+/, '');
    n = n.split('/').filter((seg) => seg !== '..' && seg !== '.' && seg !== '').join('/');
    return n || 'unnamed';
  }

  async function exportZip() {
    const done = state.items.filter((i) => i.status === 'done');
    if (!done.length) return;
    const entries = [];
    const used = new Set();
    for (const item of done) {
      const name = sanitizeZipName(item.relPath);
      let uniq = name;
      let k = 1;
      while (used.has(uniq)) {
        const dot = name.lastIndexOf('.');
        uniq = dot > 0 ? name.slice(0, dot) + '_' + k + name.slice(dot) : name + '_' + k;
        k++;
      }
      used.add(uniq);
      entries.push({ name: uniq, data: new Uint8Array(await item.resultBlob.arrayBuffer()) });
    }
    const zip = await PI.buildZip(entries);
    const stamp = new Date().toISOString().slice(0, 10);
    window.__pi.downloadBlob(new Blob([zip], { type: 'application/zip' }), 'converted_' + stamp + '.zip');
  }

  // ---------- 启动：UI 立即可交互，引擎首帧后预热 ----------
  function warmup() {
    try {
      const c = document.createElement('canvas');
      c.width = 4; c.height = 4;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.getImageData(0, 0, 4, 4);
    } catch (e) { /* 非致命 */ }
    if (typeof CompressionStream === 'undefined' && typeof DecompressionStream === 'undefined') {
      $('#btnExportZip').title = '当前浏览器不支持压缩流，ZIP 导出不可用';
    }
  }

  function boot() {
    loadSettings();
    renderSettings();
    bindImport();
    bindSettings();
    bindActions();
    refresh();
    requestAnimationFrame(() => setTimeout(warmup, 0));
  }

  window.__pi = {
    state, currentSettings, downloadBlob, yieldUI,
    convertAll, convertOne, exportZip,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
```

- [ ] **Step 2: 写 build.js**

```js
'use strict';
/* 把 src 内联为单文件 index.html（零外部请求） */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('src/index.template.html');
html = html.replace('<!--STYLE-->', '<style>\n' + read('src/style.css') + '\n</style>');
html = html.replace('<!--LOGIC-->', read('src/logic.js'));
html = html.replace('<!--APP-->', read('src/app.js'));

// 安全自检：交付物中不得出现网络引用、动态代码执行或 innerHTML 注入
const forbidden = [
  /\bhttps?:\/\//g, /\bfetch\s*\(/g, /\bXMLHttpRequest\b/g, /new\s+WebSocket\b/g, /<link\b/g,
  /\beval\s*\(/g, /new\s+Function\b/g, /\.innerHTML\s*=/g,
];
for (const re of forbidden) {
  if (re.test(html)) throw new Error('build 失败：交付物含网络相关引用: ' + re);
}

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('build ok -> index.html (' + (html.length / 1024).toFixed(1) + ' KB)');
```

- [ ] **Step 3: 构建并自检**

Run: `node build.js`
Expected: `build ok -> index.html (xxx.x KB)`（无网络引用报错）

- [ ] **Step 4: 生成夹具 + 全量测试**

```bash
node tools/gen-fixtures.js
node --test tests/
```

Expected: 全部 PASS（含 Python `PYZIP_OK` 交叉验证）

- [ ] **Step 5: E2E 浏览器手测**（Windows 打开默认浏览器）

```bash
explorer.exe "W:\0_proj\PHOTO_INTEGRATION\index.html"
```

手测清单：
1. 双击/打开后 UI 立即显示，无闪烁等待
2. 「选择文件夹」选 `tests/fixtures/` → 7 张全部入列，缩略图可见，名字正确
3. 拖入 `tests/fixtures/tall.png` 与 `wide.png` → 入列
4. 设置：50 KB / 1:1 / 240px / 保持原格式 / 容差 2%
5. 「开始转换」→ 进度条推进、状态逐个变化、可「取消」
6. 全部完成：每张大小 ∈ [49KB, 51KB]（PNG 特殊：≤ 51KB，且 PNG 原图保留）；`tall.png`/`wide.png` 输出为正方形（240×240）；`small.png`/`lowcontrast.png` 显示更清晰（锐化+对比度）；`withalpha.png` 透明区域保留
7. 文件名不变（扩展名转换规则正确：solid.png→solid.jpg 等）
8. 「下载 ZIP」→ 解压后文件名/相对路径/大小一致；用 Python 验证：`python -c "import zipfile; z=zipfile.ZipFile('下载的zip'); print(z.testzip()); print(z.namelist())"`
9. 「下载」单张按钮可用
10. 移动端：DevTools 切 iPhone 视口 → 布局单列、按钮可触控、底部操作栏固定
11. 刷新页面 → 设置被记忆（localStorage）
12. 断网状态重复上述操作（验证零联网）

- [ ] **Step 6: 写 README.md**

```markdown
# 图片批量转换（本地 · 零联网）

把任意图片或文件夹里的所有图片，统一转换为**相同比例、相同大小**的图片，适合在 1.5×1.5 cm 小屏幕上清晰显示。

## 使用方法

1. 用任意现代浏览器（Chrome / Edge / Firefox）打开 `index.html`
2. 拖入图片/文件夹，或点击「选择图片 / 选择文件夹」
3. 在「输出设置」中调整：目标大小（默认 50 KB）、输出比例（默认 1:1 正方形）、最长边（默认 240px）、输出格式（默认保持原格式）
4. 点击「开始转换」，完成后「下载 ZIP」批量导出（文件名与文件夹结构不变），也可单张下载

## 输出规则

- **统一比例**：默认 1:1 正方形。原图过宽 → 居中裁左右；原图过高 → 按 3:7 裁上下（上方 30%、下方 70%），保留人脸等主体偏上的构图
- **统一大小**：JPEG 精确命中目标大小（±容差，默认 ±2%）；PNG 为无损格式，结果 ≤ 目标大小×（1+容差）。内容极简的图像可能低于目标（最高质量下也无法更大）
- **低清增强**：源图小于目标时自动高质量上采样 + 锐化 + 自动对比度
- **输出格式**：JPEG / JPG / PNG 可选；「保持原格式」时 PNG 输出 PNG，其余输出 JPEG(.jpg)

## 平台

- **Windows / Linux**：任意浏览器双击打开
- **Android**：把 `index.html` 复制到手机，用 Chrome / Edge 打开（文件管理器中选择 → 浏览器打开）；「选择文件夹」在 Android Chrome 中同样可用
- 纯本地运行，不发起任何网络请求，图片不会离开你的设备

## 常见问题

- **HEIC 等格式无法解码**：浏览器不支持，请先用系统工具转换为 JPEG/PNG
- **转换后的图片小于目标大小**：内容极简单时最高质量也达不到目标，属正常现象
- **隐私**：本工具无网络功能，可放心处理私人照片

## 开发

```bash
node --test tests/     # 单元测试（逻辑层）
node build.js          # 由 src/ 重新打包 index.html
node tools/gen-fixtures.js  # 重新生成测试图片
```

源文件：`src/logic.js`（纯逻辑）、`src/app.js`（UI/管线）、`src/style.css`、`src/index.template.html`。零第三方依赖。
```

- [ ] **Step 7: Commit**

```bash
git add src/app.js build.js index.html README.md
git commit -m "feat: ZIP 导出、启动时序、构建脚本与 README；E2E 验证通过"
```

---

### Task 10: 收尾自审

- [ ] **Step 1: 规格对照核查**（逐条过 spec：零联网 ✓ / 50KB±2% ✓ / 240px ✓ / 1:1 与 3:7 裁剪 ✓ / 低清增强 ✓ / 格式三选 ✓ / 名字不变 ✓ / ZIP 导出 ✓ / 快速启动 ✓ / 移动端+桌面 ✓ / 暗色 ✓）

- [ ] **Step 1b: 安全自审**
1. build 自检已通过（无 http/fetch/XHR/WebSocket/eval/new Function/innerHTML/link）
2. ZIP 条目名经 `sanitizeZipName`（盘符、`..`、前导斜杠已清理）——用 `python -c "import zipfile; z=zipfile.ZipFile(...); print([n for n in z.namelist() if n.startswith(('..','/','C:'))])"` 抽查导出的 ZIP 无异常条目
3. 文件名在 UI 中以 textContent 渲染（无 HTML 注入）
4. 交付物仅 `index.html`（+README），开发文件在 `src/` `tests/` `tools/` 与交付分离

- [ ] **Step 2: 交付物完整性检查**

```bash
ls -la index.html
du -h index.html
grep -c "http" index.html || echo "无 http 引用"
node --check index.html 2>/dev/null || echo "（HTML 无法 node --check，跳过）"
```

Expected: index.html 存在、无 http 引用

- [ ] **Step 3: 最终 commit（如无改动则跳过）**

```bash
git add -A
git commit -m "chore: 最终自审" --allow-empty
```
