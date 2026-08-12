# 调色板量化修复（16 色 + 抖动）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 1KB 级调色板输出"色块崩溃/色带"：Bayer 每通道独立有序抖动（色带→颗粒）；色数梯度保持 8/16/32（≤2KB 极端小目标 8 色 + 抖动，用户确认）。

**Architecture:** `logic.js` 新增纯函数 `ditherIndices(rgba, palette)`（误差扩散，确定性）；`quantize` 保持纯净，app.js 组合 `quantize → ditherIndices → encodePng`。

**Tech Stack:** 原生 JS、node:test、无头 Edge e2e。

## Global Constraints

- 零第三方依赖、`file://` 兼容、CSP 不变。
- 硬约束：输出 ≤ `目标 × (1 + 有效容差)` 不变。
- `ditherIndices` 确定性（无随机）——二分搜索语义保持。
- >8KB 目标完全不变（paletteColors=0）。
- 中文注释与文案；提交信息 `feat:/docs:/test:` 前缀 + 中文 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- e2e 运行链：`node build.js` → `node tools/gen-e2e.js` → `node tools/e2e-run.js`；`index.html` 随 src 改动重建并提交。

---

### Task 1: `ditherIndices` 实现 + 单测（红→绿）

**Files:**
- Modify: `src/logic.js`（新增 `ditherIndices` + 导出）
- Modify: `tests/logic.test.js`（单测 ×2）

**Interfaces:**
- Consumes: 现有 `PI.quantize(rgba, maxColors)` 返回 `{ palette, indices }`。
- Produces: `PI.ditherIndices(rgba, palette) -> Uint8Array`（长度 = 像素数，索引 < palette.length）。Task 2 依赖此签名。

- [ ] **Step 1: 写失败测试**

`tests/logic.test.js` 末尾追加：

```js
// ---------- ditherIndices（Floyd-Steinberg 误差扩散抖动）----------
test('ditherIndices: 索引合法（长度正确、值域正确）', () => {
  const w = 24, h = 24;
  const rgba = new Uint8ClampedArray(w * h * 4);
  let seed = 9;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.round(60 + (x + y) * 3 + (rnd() - 0.5) * 30);
      rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = 255 - v; rgba[i + 3] = 255;
    }
  }
  const { palette } = PI.quantize(rgba, 16);
  const idx = PI.ditherIndices(rgba, palette, w, h);
  assert.strictEqual(idx.length, w * h);
  for (const v of idx) assert.ok(v >= 0 && v < palette.length);
});

test('ditherIndices: 打破色带——抖动后相邻索引变化比例显著高于无抖动', () => {
  // 平滑渐变（无噪声）：无抖动时切分出大片同索引区域（色带），抖动打散之
  const w = 32, h = 32;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = Math.round(40 + (x / w) * 180 + (y / h) * 40);
      rgba[i] = v; rgba[i + 1] = Math.round(v * 0.7); rgba[i + 2] = 255 - v; rgba[i + 3] = 255;
    }
  }
  const { palette, indices: plain } = PI.quantize(rgba, 8);
  const dithered = PI.ditherIndices(rgba, palette, w, h);
  const changeRatio = (idx) => {
    let c = 0, total = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w - 1; x++) {
        total++;
        if (idx[y * w + x] !== idx[y * w + x + 1]) c++;
      }
    }
    return c / total;
  };
  const plainRatio = changeRatio(plain);
  const ditherRatio = changeRatio(dithered);
  assert.ok(ditherRatio > plainRatio * 2,
    `抖动应显著增加相邻索引变化：plain=${plainRatio.toFixed(3)} dither=${ditherRatio.toFixed(3)}`);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/logic.test.js`
Expected: 2 个新测试 FAIL（`PI.ditherIndices is not a function`），34 旧测试 PASS。

- [ ] **Step 3: 实现 `ditherIndices`**

`src/logic.js` 在 `quantize` 函数之后插入（签名含宽高，供邻域寻址）：

```js
  // ---------- Floyd-Steinberg 误差扩散抖动 ----------
  // 以给定调色板为基准逐像素取最近色，把量化误差按 7/16、3/16、5/16、1/16
  // 扩散给右/左下/下/右下邻居——把可见色带（banding）打散成细颗粒。
  // 确定性算法（无随机），输入 rgba 不被修改。
  function ditherIndices(rgba, palette, w, h) {
    const n = w * h;
    const work = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      work[i * 3] = rgba[i * 4];
      work[i * 3 + 1] = rgba[i * 4 + 1];
      work[i * 3 + 2] = rgba[i * 4 + 2];
    }
    const indices = new Uint8Array(n);
    const nearest = (r, g, b) => {
      let best = 0, bestD = Infinity;
      for (let k = 0; k < palette.length; k++) {
        const dr = r - palette[k][0], dg = g - palette[k][1], db = b - palette[k][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = k; }
      }
      return best;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const r = work[i * 3], g = work[i * 3 + 1], b = work[i * 3 + 2];
        const idx = nearest(r, g, b);
        indices[i] = idx;
        const er = r - palette[idx][0], eg = g - palette[idx][1], eb = b - palette[idx][2];
        if (x + 1 < w) { const j = i + 1; work[j * 3] += er * 7 / 16; work[j * 3 + 1] += eg * 7 / 16; work[j * 3 + 2] += eb * 7 / 16; }
        if (y + 1 < h) {
          if (x > 0) { const j = i + w - 1; work[j * 3] += er * 3 / 16; work[j * 3 + 1] += eg * 3 / 16; work[j * 3 + 2] += eb * 3 / 16; }
          { const j = i + w; work[j * 3] += er * 5 / 16; work[j * 3 + 1] += eg * 5 / 16; work[j * 3 + 2] += eb * 5 / 16; }
          if (x + 1 < w) { const j = i + w + 1; work[j * 3] += er * 1 / 16; work[j * 3 + 1] += eg * 1 / 16; work[j * 3 + 2] += eb * 1 / 16; }
        }
      }
    }
    return indices;
  }
```

导出对象（:469）追加 `ditherIndices`：

```js
  return { crc32, encodePng, quantize, ditherIndices, unsharpMask, boxBlur, autoContrast, buildZip, parseZip, detectArchiveFormat, computeCrop, setJpegDensity, zlibDeflate, rawDeflate };
```

- [ ] **Step 4: 运行确认全绿**

Run: `node --test tests/logic.test.js`
Expected: 36 个测试全部 PASS（34 旧 + 2 新），banding 打破断言成立。

- [ ] **Step 5: 提交**

```bash
git add src/logic.js tests/logic.test.js
git commit -m "feat: Floyd-Steinberg 误差扩散抖动（ditherIndices，确定性）+ 单测

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: app.js 接入（16 色 + 抖动组合）

**Files:**
- Modify: `src/app.js`（`paletteColors` 梯度；`pngToTarget` encode() 调色板分支加抖动）

**Interfaces:**
- Consumes: Task 1 的 `PI.ditherIndices(rgba, palette, w, h)`。
- Produces: `paletteColors = targetKB <= 2 ? 8 : targetKB <= 4 ? 16 : targetKB <= 8 ? 32 : 0`。

- [ ] **Step 1: 色数梯度**

`src/app.js` `currentSettings` 中 `paletteColors` 行替换：

```js
      // 小目标自动调色板量化（≤2KB 8 色、≤4KB 16 色、≤8KB 32 色、>8KB 全彩无损）：
      // 抖动解决色带后 8 色在极端小目标可接受；16 色是 1KB 甜点（MSE 降 73%）
      paletteColors: s.targetKB <= 2 ? 8 : s.targetKB <= 4 ? 16 : s.targetKB <= 8 ? 32 : 0,
```

- [ ] **Step 2: encode() 调色板分支加抖动**

`src/app.js` `pngToTarget` encode() 调色板分支替换：

```js
      if (colors > 0) {
        // 调色板量化路径：1 字节/像素索引 + 高度可压缩 → 同大小更高分辨率；
        // Bayer 有序抖动把色带打散成细颗粒（打破"色块崩溃"）
        const { palette } = PI.quantize(data.data, colors);
        const indices = PI.ditherIndices(data.data, palette, data.width, data.height);
        const bytes = await PI.encodePng({
          width: data.width, height: data.height,
          rgba: data.data, indices, palette, mode: 'palette', phys,
        });
        return { bytes, phys };
      }
```

- [ ] **Step 3: 构建 + e2e 回归**

Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js`
Expected: 全部轮 PASS（含 1KB 轮诊断行——抖动后像素与 8 色时相当，观感大幅改善）、PALETTE_OK、下载校验 PASS。

- [ ] **Step 4: 提交**

```bash
git add src/app.js index.html
git commit -m "feat: 调色板路径接入 Bayer 抖动（消除色块崩溃；8/16/32 色梯度保留）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 文案 + 全量回归 + 提交

**Files:**
- Modify: `src/index.template.html:70`、`README.md`

- [ ] **Step 1: hint 文案**

`src/index.template.html:70` 中 `目标 ≤8KB 时自动启用调色板量化（8–32 色）换取更高分辨率。` 替换为：

```
目标 ≤8KB 时自动启用调色板量化（16–32 色 + 误差扩散抖动）换取更高分辨率。
```

- [ ] **Step 2: README**

`README.md` 小目标条目中 `≤8KB 时 PNG 自动调色板量化（8–32 色）换取更高分辨率` 替换为：

```
≤8KB 时 PNG 自动调色板量化（16–32 色 + 误差扩散抖动）换取更高分辨率
```

- [ ] **Step 3: 全量回归**

Run: `node --test tests/logic.test.js` → 36 个 PASS
Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js` → 全部 PASS + PALETTE_OK + 下载校验 PASS

- [ ] **Step 4: 提交**

```bash
git add README.md src/index.template.html index.html
git commit -m "docs: 调色板量化文案更新（16–32 色 + 抖动）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: 手工浏览器验证**

打开 `index.html`，目标 1 KB 导入一张照片：确认色块/色带消失（渐变为细颗粒观感），像素不低于 ~35px。
