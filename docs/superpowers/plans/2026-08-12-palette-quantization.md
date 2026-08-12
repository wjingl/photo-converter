# 小目标调色板量化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 目标 ≤8KB 时 PNG 自动启用调色板量化（8/16/32 色随目标缩放），降色彩精度换更高分辨率。

**Architecture:** `quantize` 与 `encodePng(palette)` 已实现且未用（含单测）。接入点仅两处：`pngToTarget` 增加 `colors` 参数（量化路径二分），`convertOne` 分支条件化（量化路径跳过 oxipng 与锐化）。e2e 用 python 读下载文件 IHDR colorType 强断言。

**Tech Stack:** 原生 JS（零依赖）、node:test、无头 Edge e2e、python（e2e-run 校验）。

## Global Constraints

- 零第三方依赖、`file://` 兼容、CSP 不变。
- 硬约束：输出 ≤ `目标 × (1 + 有效容差)` 不变；量化路径二分下限仍为 16px。
- >8KB 目标完全不变（paletteColors=0 → 全彩无损 + oxipng + 锐化，现有行为）。
- 调色板 PNG 为标准格式（PLTE 索引图），pHYs 照常写入。
- 中文注释与文案；提交信息 `feat:/docs:` 前缀 + 中文 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- e2e 运行链：`node build.js` → `node tools/gen-e2e.js` → `node tools/e2e-run.js`；`index.html` 随 src 改动重建并提交。

---

### Task 1: 量化压缩收益单测（补覆盖）

**Files:**
- Modify: `tests/logic.test.js`

**Interfaces:**
- Consumes: 现有 `PI.quantize(rgba, maxColors)`、`PI.encodePng({ width, height, rgba, indices, palette, mode:'palette', phys })`（均有测试）。
- Produces: 无（纯测试补充）。

- [ ] **Step 1: 追加测试**

`tests/logic.test.js` 末尾追加：

```js
test('encodePng palette: 同像素下量化编码显著小于全彩（压缩收益）', async () => {
  const w = 48, h = 48;
  // 模拟照片：平滑渐变 + 噪声（含透明像素）
  const rgba = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const base = Math.round(60 + (x + y) * 1.6 + (rnd() - 0.5) * 30);
      rgba[i] = base; rgba[i + 1] = Math.round(base * 0.8); rgba[i + 2] = 255 - base;
      rgba[i + 3] = (x + y) % 7 === 0 ? 100 : 255; // 部分透明
    }
  }
  const rgb = await PI.encodePng({ width: w, height: h, rgba, mode: 'rgb', phys: 300 });
  const { palette, indices } = PI.quantize(rgba, 8);
  const pal = await PI.encodePng({ width: w, height: h, rgba, indices, palette, mode: 'palette', phys: 300 });
  assert.ok(pal.length < rgb.length * 0.7, `量化应显著更小：palette=${pal.length} vs rgb=${rgb.length}`);
});
```

- [ ] **Step 2: 运行确认绿**

Run: `node --test tests/logic.test.js`
Expected: 34 个测试全部 PASS（量化压缩收益断言成立——48px 模拟照片 8 色应 < 全彩的 70%）。

- [ ] **Step 3: 提交**

```bash
git add tests/logic.test.js
git commit -m "test: 调色板量化压缩收益断言（同像素 palette < 全彩 70%）"

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: app.js 接入（paletteColors + 量化路径）

**Files:**
- Modify: `src/app.js`（`currentSettings` 加 `paletteColors`；`pngToTarget` 加 `colors` 参数；`convertOne` PNG 分支条件化）

**Interfaces:**
- Consumes: `PI.quantize(rgba, maxColors)` 返回 `{ palette, indices }`；`PI.encodePng({ width, height, rgba, indices, palette, mode: 'palette', phys })`；现有 `pngToTarget(canvas, targetBytes, tolerance, physMaxCm, targetKB, srcMaxEdge, onEnc)`。
- Produces: `currentSettings()` 新增 `paletteColors`（number：8/16/32/0）；`pngToTarget` 新签名加第 8 参 `colors`。Task 3 的 e2e 依赖"1KB 轮所有 PNG 输出均为调色板格式"。

- [ ] **Step 1: `currentSettings` 加 `paletteColors`**

`src/app.js` `currentSettings` 返回对象内、`denoisePasses` 行之后追加：

```js
      // 小目标自动调色板量化（≤2KB 8 色、≤4KB 16 色、≤8KB 32 色、>8KB 全彩无损）：
      // 降色彩精度换像素密度——1KB 照片可到 ~48px（全彩仅 ~23px）
      paletteColors: s.targetKB <= 2 ? 8 : s.targetKB <= 4 ? 16 : s.targetKB <= 8 ? 32 : 0,
```

- [ ] **Step 2: `pngToTarget` 增加量化路径**

`src/app.js` `pngToTarget` 签名（`:843`）加第 8 参：

```js
  async function pngToTarget(canvas, targetBytes, tolerance, physMaxCm, targetKB, srcMaxEdge, onEnc, colors = 0) {
```

`encode` 函数体（当前全彩直编）替换为（含量化分支）：

```js
    const encode = async (c) => {
      if (onEnc) onEnc();
      const data = getData(c);
      let hasAlpha = false;
      for (let i = 3; i < data.data.length; i += 4) {
        if (data.data[i] !== 255) { hasAlpha = true; break; }
      }
      const phys = dpiFromPx(Math.max(c.width, c.height), physMaxCm);
      if (colors > 0) {
        // 调色板量化路径：1 字节/像素索引 + 高度可压缩 → 同大小更高分辨率
        const { palette, indices } = PI.quantize(data.data, colors);
        const bytes = await PI.encodePng({
          width: data.width, height: data.height,
          rgba: data.data, indices, palette, mode: 'palette', phys,
        });
        return { bytes, phys };
      }
      const bytes = await PI.encodePng({
        width: data.width, height: data.height,
        rgba: data.data, mode: hasAlpha ? 'rgba' : 'rgb', phys,
      });
      return { bytes, phys };
    };
```

- [ ] **Step 3: `convertOne` 调用传 `paletteColors` + 分支条件化**

调用点（`src/app.js` PNG 分支第一行）加第 8 参：

```js
      const r = await pngToTarget(canvas, s.targetBytes, s.effTol, physMaxCm, s.targetKB, srcMaxEdge, onEnc, s.paletteColors);
```

将 PNG 分支的锐化条件改为仅全彩（量化路径跳过——锐化引入颜色跳变扰乱索引）：

```js
      // 压缩后锐化（PNG 此前缺失）：缩小才锐化，强度随缩小比例（与 JPEG 路径一致）；
      // 调色板路径跳过——锐化引入颜色跳变会扰乱索引
      if (s.paletteColors === 0 && r.edge < Math.max(cw, ch)) {
        const ratio = Math.max(cw, ch) / r.edge;
        lightSharpen(finalCanvas, ratio > 4 ? 0.5 : ratio > 2 ? 0.45 : 0.4);
      }
```

将 oxipng 重编码段改为仅全彩（封装仅收 RGBA 全彩输入；调色板直出自写编码器结果）：

```js
      if (s.paletteColors === 0) {
        const oxiData = finalCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, finalCanvas.width, finalCanvas.height);
        const oxiBytes = await encodePngOxipng(oxiData.data, finalCanvas.width, finalCanvas.height);
        const high = Math.min(s.targetBytes * (1 + s.effTol), s.targetBytes + 5000);
        if (oxiBytes && oxiBytes.length <= high && oxiBytes.length <= r.blob.size) {
          item.resultBlob = new Blob([insertPngPhys(oxiBytes, physDpi)], { type: 'image/png' });
        } else {
          item.resultBlob = r.blob; // oxipng 不可用/超限/压缩更差 → 回退自写编码（已含 pHYs）
        }
      } else {
        item.resultBlob = r.blob; // 调色板直出（已含 pHYs）
      }
```

（注意：`oxiData`/`oxiBytes`/`high` 变量移入全彩分支作用域；原 `insertPngPhys` 逻辑不变。`outPxW/outPxH/outDpi` 赋值与 note 逻辑保持在分支外不变。）

- [ ] **Step 4: 构建 + e2e 回归**

Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js`
Expected: 全部轮 PASS（含"1KB 轮输出分辨率"诊断行——照片类像素应显著高于全彩路径：photo-input 预期 40px+）；下载全部校验 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/app.js index.html
git commit -m "feat: 小目标（≤8KB）PNG 自动调色板量化（8/16/32 色）——降色彩精度换像素密度

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: e2e 强断言 + 文案 + 全量回归

**Files:**
- Modify: `tools/e2e-run.js`（下载全部校验扩展：python 断言 9 个 PNG 全部 colorType=3）
- Modify: `src/index.template.html:70`（hint 文案）
- Modify: `README.md`（小目标条目）

**Interfaces:**
- Consumes: Task 2 的 `paletteColors` 语义（1KB 轮所有 PNG 输出均调色板）。

- [ ] **Step 1: e2e-run 下载全部校验扩展为 python 断言 colorType**

`tools/e2e-run.js` 中"下载全部（逐张下载）校验"段（当前 node 大小检查）整体替换为：

```js
    const imgs = fs.readdirSync(dlDir).filter((f) => !f.endsWith('.zip'));
    console.log('=== 下载全部（逐张下载）校验 ===');
    console.log('文件数=' + imgs.length + '（期望 9：7 PNG + 2 JPEG，坏文件跳过）');
    const over = imgs.filter((f) => fs.statSync(path.join(dlDir, f)).size > 1147);
    console.log(imgs.length === 9 && over.length === 0
      ? '下载全部校验: PASS（9 张全部 ≤ 1.12KB）'
      : '下载全部校验: FAIL（' + (imgs.length !== 9 ? '期望 9 实际 ' + imgs.length : '超出 1.12KB: ' + over.join(', ')) + '）');
    // 1KB 轮全部 PNG 应走调色板量化（IHDR colorType=3）——强断言
    if (imgs.length === 9) {
      const py2 = spawnSync('python', ['-c',
        'import glob,os,sys\n' +
        'pngs=[f for f in glob.glob(os.path.join(sys.argv[1],"*.png"))]\n' +
        'assert len(pngs)==9, "应有 9 个 PNG: %d" % len(pngs)\n' +
        'for p in pngs:\n' +
        '  h=open(p,"rb").read(26)\n' +
        '  assert h[:8]==b"\\x89PNG\\r\\n\\x1a\\n", "非 PNG: %s" % p\n' +
        '  ct=h[25]  # IHDR: sig8+len4+type4+width4+height4+depth1 = 25 处为 colorType\n' +
        '  assert ct==3, "colorType=%d 应为 3(调色板): %s" % (ct, os.path.basename(p))\n' +
        'print("PALETTE_OK: 9 个 PNG 全部为调色板(8 色)")',
        dlDir.replace(/\\/g, '/')], { encoding: 'utf8' });
      console.log('=== 调色板量化校验 ===');
      console.log(py2.status === 0 ? (py2.stdout || 'PALETTE_OK') : ('PALETTE_FAIL: ' + py2.stderr));
    }
```

（注意 `spawnSync` 已在文件上方 ZIP 校验段 require，直接复用。python 内 `"\\x89PNG..."` 为 Python 字节转义。）

- [ ] **Step 2: hint 文案**

`src/index.template.html:70` hint 末尾追加：

```
目标 ≤8KB 时自动启用调色板量化（8–32 色）换取更高分辨率。
```

- [ ] **Step 3: README**

`README.md` 小目标条目末尾追加：

```
；≤8KB 时 PNG 自动调色板量化（8–32 色）换取更高分辨率
```

- [ ] **Step 4: 全量回归**

Run: `node --test tests/logic.test.js` → 34 个 PASS
Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js` → 全部 PASS + `PALETTE_OK` + 下载校验 PASS + ZIP 校验 OK

- [ ] **Step 5: 提交**

```bash
git add README.md src/index.template.html index.html tools/e2e-run.js
git commit -m "docs: 调色板量化说明 + e2e 强断言（1KB 轮 PNG 全部 colorType=3）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 6: 手工浏览器验证**

打开 `index.html`，目标 1 KB 导入一张照片：确认 PNG 输出分辨率较全彩路径显著提升（预览弹层 px 值，预期 40px+），8 色渐变带在小屏观感可接受。
