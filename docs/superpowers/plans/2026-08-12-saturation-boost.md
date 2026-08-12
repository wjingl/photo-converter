# 小目标饱和增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小目标（≤8KB）输出"发灰"问题：压缩前自动饱和增强（≤2KB +25%、2–8KB +12%），PNG 与 JPEG 路径统一。

**Architecture:** `logic.js` 新增纯函数 `boostSaturation`（RGB 向亮度拉伸）；`currentSettings` 加 `satBoost`；`convertOne` 两路径在去噪后应用。

**Tech Stack:** 原生 JS、node:test、无头 Edge e2e。

## Global Constraints

- 零第三方依赖、`file://` 兼容、CSP 不变；硬约束（≤ 目标×(1+有效容差)）不变。
- 灰度/黑白像素不受饱和增强影响（r=g=b → 不变量）。
- >8KB 目标完全不变（satBoost=0）。
- 中文注释与文案；提交信息 `feat:/docs:/test:` 前缀 + 中文 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- e2e 运行链：`node build.js` → `node tools/gen-e2e.js` → `node tools/e2e-run.js`；`index.html` 随 src 重建并提交。

---

### Task 1: `boostSaturation` + 单测（红→绿）

**Files:**
- Modify: `src/logic.js`、`tests/logic.test.js`

**Interfaces:**
- Produces: `PI.boostSaturation(rgba, w, h, amount) -> rgba`（amount 0~1，原地修改）。Task 2 依赖。

- [ ] **Step 1: 写失败测试**

`tests/logic.test.js` 末尾追加：

```js
// ---------- boostSaturation（饱和增强）----------
test('boostSaturation: 灰度与黑白像素不变，值域合法', () => {
  const rgba = new Uint8ClampedArray(4 * 1 * 4);
  rgba[0] = 120; rgba[1] = 120; rgba[2] = 120; rgba[3] = 255; // 灰
  rgba[4] = 0; rgba[5] = 0; rgba[6] = 0; rgba[7] = 255;       // 黑
  rgba[8] = 255; rgba[9] = 255; rgba[10] = 255; rgba[11] = 255; // 白
  const before = Array.from(rgba);
  PI.boostSaturation(rgba, 4, 1, 0.5);
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(rgba[i], before[i]);     // 灰不变
    assert.strictEqual(rgba[4 + i], before[4 + i]);   // 黑不变
    assert.strictEqual(rgba[8 + i], before[8 + i]);   // 白不变
    assert.strictEqual(rgba[i * 4 + 3], 255);   // alpha 不动
  }
});

test('boostSaturation: 彩色像素饱和度提升（max-min 增大）', () => {
  const rgba = new Uint8ClampedArray([200, 100, 50, 255]);
  const sat = (r, g, b) => (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(1, Math.max(r, g, b));
  const before = sat(200, 100, 50);
  PI.boostSaturation(rgba, 1, 1, 0.3);
  const after = sat(rgba[0], rgba[1], rgba[2]);
  assert.ok(after > before, `饱和度应提升：${before.toFixed(3)} -> ${after.toFixed(3)}`);
  assert.ok(rgba.every((v) => v <= 255 && v >= 0));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/logic.test.js`
Expected: 2 个新测试 FAIL（`PI.boostSaturation is not a function`），38 旧测试 PASS。

- [ ] **Step 3: 实现**

`src/logic.js` 在 `ditherIndices` 之后插入：

```js
  // ---------- 饱和增强 ----------
  // RGB 向亮度拉伸：l=(r+g+b)/3，c' = clamp(l + (c-l)×(1+amount))。
  // 灰度（r=g=b）与纯黑/纯白不变；彩色像素饱和度提升——补偿压缩（去噪/量化/
  // JPEG 色度下采样）造成的发灰。确定性，原地修改。
  function boostSaturation(rgba, w, h, amount) {
    const k = 1 + amount;
    for (let i = 0; i < w * h * 4; i += 4) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const l = (r + g + b) / 3;
      const nr = Math.round(l + (r - l) * k);
      const ng = Math.round(l + (g - l) * k);
      const nb = Math.round(l + (b - l) * k);
      rgba[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      rgba[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      rgba[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
    return rgba;
  }
```

导出对象追加 `boostSaturation`：

```js
  return { crc32, encodePng, quantize, ditherIndices, boostSaturation, unsharpMask, boxBlur, autoContrast, buildZip, parseZip, detectArchiveFormat, computeCrop, setJpegDensity, zlibDeflate, rawDeflate };
```

- [ ] **Step 4: 运行确认全绿**

Run: `node --test tests/logic.test.js`
Expected: 40 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/logic.js tests/logic.test.js
git commit -m "feat: 饱和增强 boostSaturation（RGB 向亮度拉伸）+ 单测

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: app.js 接入（satBoost + 两路径插入）

**Files:**
- Modify: `src/app.js`

**Interfaces:**
- Consumes: Task 1 的 `PI.boostSaturation(rgba, w, h, amount)`。
- Produces: `currentSettings()` 新增 `satBoost`（number：0.25/0.12/0）。

- [ ] **Step 1: `currentSettings` 加 `satBoost`**

`src/app.js` `paletteColors` 行之后追加：

```js
      // 小目标自动饱和增强（≤2KB +25%、≤8KB +12%、>8KB 不做）：
      // 补偿压缩（去噪/量化/JPEG 色度下采样）造成的发灰
      satBoost: s.targetKB <= 2 ? 0.25 : s.targetKB <= 8 ? 0.12 : 0,
```

- [ ] **Step 2: PNG 路径插入（去噪后、量化前）**

`src/app.js` PNG 分支，去噪块（`if (s.denoisePasses > 0) { ... }`）之后插入：

```js
      // 小目标自动饱和增强：补偿量化格心平均化造成的发灰（灰度像素不受影响）
      if (s.satBoost > 0) {
        const sctx = finalCanvas.getContext('2d', { willReadFrequently: true });
        const simg = sctx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
        PI.boostSaturation(simg.data, finalCanvas.width, finalCanvas.height, s.satBoost);
        sctx.putImageData(simg, 0, 0);
      }
```

- [ ] **Step 3: JPEG 路径插入（去噪后、锐化前）**

`src/app.js` JPEG 分支，去噪块之后、`if (r.edge < Math.max(cw, ch))` 锐化之前插入同样代码块（与 Step 2 相同）。

- [ ] **Step 4: 构建 + e2e 回归**

Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js`
Expected: 全部轮 PASS（PALETTE_OK、下载校验、ZIP 校验）；1KB 轮诊断行像素可能因熵增略降（观察性）。

- [ ] **Step 5: 提交**

```bash
git add src/app.js index.html
git commit -m "feat: 小目标（≤8KB）自动饱和增强（≤2KB +25%、≤8KB +12%），PNG/JPEG 统一

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 文案 + 全量回归 + 提交

**Files:**
- Modify: `src/index.template.html:70`、`README.md`

- [ ] **Step 1: hint 文案**

`src/index.template.html:70` 小目标句子后追加：

```
目标 ≤8KB 时自动增强饱和度（补偿压缩发灰）。
```

- [ ] **Step 2: README**

`README.md` 小目标条目末尾追加：

```
；≤8KB 时自动增强饱和度（补偿压缩发灰）
```

- [ ] **Step 3: 全量回归**

Run: `node --test tests/logic.test.js` → 40 个 PASS
Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js` → 全部 PASS + 校验 OK

- [ ] **Step 4: 提交**

```bash
git add README.md src/index.template.html index.html
git commit -m "docs: 小目标自动饱和增强说明（hint + README）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: 手工浏览器验证**

目标 1 KB 转一张照片：确认输出不再发灰（肤色/天空恢复鲜亮），颗粒感不加重，像素无明显缩水。
