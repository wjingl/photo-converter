# 小目标去噪 + 压缩后锐化管线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 目标 ≤8KB 时自动去噪（提升压缩率）+ PNG 路径补齐压缩后锐化。

**Architecture:** `logic.js` 抽出现有 `unsharpMask` 内部的盒式模糊内核为 `boxBlur`（可 node 单测）；`app.js` 的 `convertOne` 两路径统一"缩放 → 去噪 → 锐化 → 编码"。强度随目标缩放（≤1KB 2 遍、2–8KB 1 遍、>8KB 0 遍），自动无开关。

**Tech Stack:** 原生 JS（零依赖）、node:test、无头 Edge e2e。

## Global Constraints

- 零第三方依赖、`file://` 兼容、CSP `connect-src 'none'` 不变。
- 硬约束：输出 ≤ `目标 × (1 + 有效容差)` 不变（去噪只能让文件更小，绝不超上限）。
- >8KB 目标行为完全不变（不去噪、不锐化补充仅 PNG 缩小路径——JPEG 现有锐化不变）。
- `boxBlur` 只动 RGB、保留 alpha；`unsharpMask` 行为等价（现有 e2e/单测全绿回归）。
- 中文注释与文案；提交信息 `feat:/docs:` 前缀 + 中文 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- e2e 运行链：`node build.js` → `node tools/gen-e2e.js` → `node tools/e2e-run.js`。
- `index.html` 为构建产物、仓库跟踪：每次改动 src 后必须 `node build.js` 重建并随任务提交。

---

### Task 1: `boxBlur` 抽取 + 单元测试（红→绿）

**Files:**
- Modify: `src/logic.js`（新增 `blurInto` + `boxBlur`，`unsharpMask` 复用 `blurInto`）
- Modify: `tests/logic.test.js`（boxBlur 单测 ×2）

**Interfaces:**
- Consumes: 现有 `unsharpMask(rgba, w, h, radius, amount)`（`src/logic.js:208`）。
- Produces: `PI.boxBlur(rgba, w, h, passes) -> rgba`（Uint8ClampedArray，RGBA，写回 RGB，保留 alpha）。Task 2 依赖此签名。

- [ ] **Step 1: 写失败测试**

`tests/logic.test.js` 末尾追加：

```js
// ---------- boxBlur（去噪低通滤波）----------
// 邻域差分能量（方差近似）：相邻像素差平方和
function diffEnergy(rgba, w, h) {
  let e = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x < w - 1) {
        const dx = rgba[i] - rgba[i + 4];
        e += dx * dx;
      }
      if (y < h - 1) {
        const dy = rgba[i] - rgba[i + w * 4];
        e += dy * dy;
      }
    }
  }
  return e;
}

test('boxBlur: 尺寸与通道不变，均匀区域保持不变，alpha 不动', () => {
  const w = 8, h = 6;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = i % 4 === 3 ? 255 : 100; // 均匀灰
  const lenBefore = rgba.length;
  PI.boxBlur(rgba, w, h, 2);
  assert.strictEqual(rgba.length, lenBefore);
  for (let i = 0; i < rgba.length; i += 4) {
    assert.strictEqual(rgba[i], 100);
    assert.strictEqual(rgba[i + 1], 100);
    assert.strictEqual(rgba[i + 2], 100);
    assert.strictEqual(rgba[i + 3], 255); // alpha 保留
  }
});

test('boxBlur: 噪声区域方差下降（像素更平滑），遍数越多越平滑', () => {
  const w = 16, h = 16;
  const make = () => {
    const rgba = new Uint8ClampedArray(w * h * 4);
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(100 + (rnd() - 0.5) * 160);
      rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
    }
    return rgba;
  };
  const before = diffEnergy(make(), w, h);
  const once = diffEnergy(PI.boxBlur(make(), w, h, 1), w, h);
  const twice = diffEnergy(PI.boxBlur(make(), w, h, 2), w, h);
  assert.ok(once < before, `1 遍后方差应下降：${before} -> ${once}`);
  assert.ok(twice < once, `2 遍比 1 遍更平滑：${once} -> ${twice}`);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/logic.test.js`
Expected: FAIL——`PI.boxBlur is not a function`（TypeError），其余 31 个测试 PASS。

- [ ] **Step 3: 实现 `boxBlur`（logic.js）**

将 `src/logic.js` 的 `unsharpMask`（当前 :208-241）整体替换为：

```js
  // ---------- 盒式模糊内核（3×3 低通：横+纵两半遍 = 一次完整模糊）----------
  // 结果写入 Float32Array out（unsharpMask 需不减精度中间值；boxBlur 包装写回 Uint8）
  function blurInto(rgba, w, h, out) {
    const n = w * h;
    const tmp = new Float32Array(n * 3);
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
          out[i * 3 + c] = s / 3;
        }
      }
    }
    return out;
  }

  // ---------- 盒式模糊（低通滤波/去噪）----------
  // 写回 RGB、保留 alpha；passes 为完整模糊遍数（≥1 时更平滑）
  function boxBlur(rgba, w, h, passes = 1) {
    const n = w * h;
    const blur = new Float32Array(n * 3);
    for (let p = 0; p < passes; p++) {
      blurInto(rgba, w, h, blur);
      for (let i = 0; i < n * 4; i += 4) {
        const k = (i / 4) * 3;
        rgba[i] = Math.round(blur[k]);
        rgba[i + 1] = Math.round(blur[k + 1]);
        rgba[i + 2] = Math.round(blur[k + 2]);
      }
    }
    return rgba;
  }

  // ---------- 反锐化掩模（盒式模糊近似高斯 + 增强）----------
  function unsharpMask(rgba, w, h, radius = 1, amount = 0.6) {
    const n = w * h;
    const blur = new Float32Array(n * 3);
    blurInto(rgba, w, h, blur);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        const v = rgba[i * 4 + c] + amount * (rgba[i * 4 + c] - blur[i * 3 + c]);
        rgba[i * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
    }
    return rgba;
  }
```

`src/logic.js` 导出对象（:469）追加 `boxBlur`：

```js
  return { crc32, encodePng, quantize, unsharpMask, boxBlur, autoContrast, buildZip, parseZip, detectArchiveFormat, computeCrop, setJpegDensity, zlibDeflate, rawDeflate };
```

- [ ] **Step 4: 运行确认全绿**

Run: `node --test tests/logic.test.js`
Expected: 33 个测试全部 PASS（31 旧 + 2 新），`unsharpMask` 无回归。

- [ ] **Step 5: 提交**

```bash
git add src/logic.js tests/logic.test.js
git commit -m "feat: 抽取 boxBlur 盒式模糊（去噪低通滤波，unsharpMask 复用）+ 单元测试

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 管线插入（app.js）+ e2e 分辨率诊断行

**Files:**
- Modify: `src/app.js`（`currentSettings` 加 `denoisePasses`；`convertOne` PNG/JPEG 分支插入去噪 + PNG 补锐化）
- Modify: `tools/gen-e2e.js`（1KB 轮后新增分辨率诊断段）

**Interfaces:**
- Consumes: Task 1 的 `PI.boxBlur(rgba, w, h, passes)`；现有 `lightSharpen(canvas, amount)`、`scaleCanvasByEdge(canvas, edge)`。
- Produces: `currentSettings()` 新增 `denoisePasses`（number：0/1/2）。Task 3 的 hint 文案引用"目标 ≤8KB 自动去噪"语义。

- [ ] **Step 1: `currentSettings` 加 `denoisePasses`**

`src/app.js` `currentSettings` 返回对象内、`minQ` 行之后追加：

```js
      // 小目标自动去噪（≤1KB 强 2 遍、2-8KB 轻 1 遍、>8KB 不去噪）：
      // 噪声是压缩熵主源，去噪提升压缩率 → 同大小可承载更高分辨率
      denoisePasses: s.targetKB <= 1 ? 2 : s.targetKB <= 8 ? 1 : 0,
```

- [ ] **Step 2: PNG 分支插入去噪 + 补锐化**

`src/app.js` PNG 分支（`const oxiData = finalCanvas.getContext(...)` 之前、`finalCanvas` 构建之后）插入：

```js
      // 小目标自动去噪（≤8KB）：噪声是 deflate 压缩熵主源 → 去噪后同大小更高分辨率
      if (s.denoisePasses > 0) {
        const dctx = finalCanvas.getContext('2d', { willReadFrequently: true });
        const dimg = dctx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
        PI.boxBlur(dimg.data, finalCanvas.width, finalCanvas.height, s.denoisePasses);
        dctx.putImageData(dimg, 0, 0);
      }
      // 压缩后锐化（PNG 此前缺失）：缩小才锐化，强度随缩小比例（与 JPEG 路径一致）
      if (r.edge < Math.max(cw, ch)) {
        const ratio = Math.max(cw, ch) / r.edge;
        lightSharpen(finalCanvas, ratio > 4 ? 0.5 : ratio > 2 ? 0.45 : 0.4);
      }
```

- [ ] **Step 3: JPEG 分支插入去噪（现有锐化逻辑不变）**

`src/app.js` JPEG 分支（`finalCanvas` 构建之后、`if (r.edge < Math.max(cw, ch))` 锐化之前）插入：

```js
      // 小目标自动去噪（≤8KB）：去噪后文件变小 → mozjpeg 终检自动升 q 追窗口 → 同大小质量提升
      if (s.denoisePasses > 0) {
        const dctx = finalCanvas.getContext('2d', { willReadFrequently: true });
        const dimg = dctx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
        PI.boxBlur(dimg.data, finalCanvas.width, finalCanvas.height, s.denoisePasses);
        dctx.putImageData(dimg, 0, 0);
      }
```

- [ ] **Step 4: e2e 分辨率诊断段**

`tools/gen-e2e.js` 在 `// 10. 下载全部` 段之前插入：

```js
      // 9.5. 1KB 轮 PNG 输出分辨率诊断（观察性：验证去噪+锐化后分辨率不降反升）
      {
        const pxLines = [];
        for (const row of document.querySelectorAll('.file-row')) {
          if (row.querySelector('.status').textContent !== '完成') continue;
          const pvBtn = [...row.querySelectorAll('.icon-btn')].find((b) => b.textContent === '预览');
          pvBtn.click();
          await tick(300);
          const meta = document.querySelector('.modal-meta');
          const m = meta ? /(\d+)×(\d+)px @ (\d+) DPI/.exec(meta.textContent) : null;
          if (m) pxLines.push(row.querySelector('.name').textContent + '=' + m[1] + '×' + m[2] + 'px@' + m[3]);
          const close = document.querySelector('.modal-box .btn');
          if (close) close.click();
          await tick(120);
        }
        report(true, '1KB 轮输出分辨率: ' + (pxLines.join(', ') || '（无 px 元数据）'));
      }
```

- [ ] **Step 5: 构建 + e2e 全绿回归**

Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js`
Expected: 全部轮 PASS（80+ 条，含新增诊断行 PASS），无 FAIL；`下载全部校验: PASS`、ZIP 校验 OK。
观察诊断行：1KB 轮 PNG 分辨率应 ≥ 旧实现（去噪后文件更小 → 二分找到更大像素）。

- [ ] **Step 6: 提交**

```bash
git add src/app.js tools/gen-e2e.js index.html
git commit -m "feat: 小目标（≤8KB）自动去噪 + PNG 压缩后锐化（提升无损压缩率与观感）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 文案 + 全量回归 + 提交

**Files:**
- Modify: `src/index.template.html:70`（hint 追加）
- Modify: `README.md`（小目标条目补一句）

**Interfaces:**
- Consumes: Task 2 的 `denoisePasses` 语义。

- [ ] **Step 1: hint 文案**

`src/index.template.html:70` hint 段落末尾追加：

```
目标 ≤8KB 时自动轻度去噪提升压缩率，输出附锐化。
```

- [ ] **Step 2: README**

`README.md` 小目标条目（`- **小目标（≤8KB）**：...`）末尾追加：

```
；目标 ≤8KB 时自动轻度去噪提升压缩率，输出附锐化
```

- [ ] **Step 3: 全量回归**

Run: `node --test tests/logic.test.js` → 33 个 PASS
Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js` → 全部 PASS + 校验 OK

- [ ] **Step 4: 提交**

```bash
git add README.md src/index.template.html index.html
git commit -m "docs: 小目标自动去噪与输出锐化说明（hint + README）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: 手工浏览器验证**

打开 `index.html`，目标 1 KB 导入一张照片：确认 PNG 输出分辨率较旧版提升（预览弹层 px 值）、观感无明显模糊化；JPEG 输出观感正常。
