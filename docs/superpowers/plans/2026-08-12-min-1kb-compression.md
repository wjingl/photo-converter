# 压缩目标下限扩展至 ~1KB + 下载全部按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 目标大小下限从 30KB 降至 1KB（真实可压到 ~1KB）并新增「下载全部」逐张下载按钮。

**Architecture:** 全部改动集中在浏览器层 `src/app.js`（参数策略）与 `src/index.template.html`（UI），逻辑引擎 `src/logic.js` 不动。验证以无头浏览器 e2e（`tools/gen-e2e.js` 生成驱动页 + `tools/e2e-run.js` 运行校验）为主，TDD 红绿循环。

**Tech Stack:** 原生 JS（零依赖）、Canvas/CompressionStream/WASM（mozjpeg、oxipng，均已内嵌）、无头 Edge + CDP、Node 18+（node:test、python 仅用于 e2e-run 的 ZIP 校验）。

## Global Constraints

- 零第三方依赖：不得 `npm install` 任何包；不得引入需联网加载的资源。
- `file://` 兼容：所有新增代码不得依赖 http(s) 请求（CSP `connect-src 'none'`）。
- 硬约束：任何输出的文件大小 ≤ `目标 × (1 + 有效容差)`；1KB 目标轮的有效上限为 `1147B`（1.12×1024）。
- ≥21KB 目标行为与旧版完全一致（minQ=90、±2% 容差）——e2e 现有 50/30/256KB 轮断言必须原样通过。
- 中文注释与文案（与现有代码一致）。
- 提交信息格式：`feat:/fix:/docs:` 前缀 + 中文摘要（仓库惯例），结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- **工作区 WIP 保护**：`build.js`、`index.html`、`vendor/`（archive-wasm 重集成的未提交改动）是用户 WIP，不得修改、不得 `git add`。`src/index.template.html` 含用户 WIP 的 1 行（`<script><!--AW_ESM--></script>`）——本计划的 template 改动照常写入工作区，但 **template 文件不进本计划的任务提交**，最终提交方式在 Task 3 与用户确认。
- e2e 运行链：`node build.js`（src → index.html）→ `node tools/gen-e2e.js`（index.html → tests/out/e2e.html）→ `node tools/e2e-run.js`（无头 Edge 执行，最多 300s）。

---

### Task 1: 参数调整 D1–D4 + e2e 1KB 轮（红→绿）

**Files:**
- Modify: `src/app.js`（clamp ×2、`currentSettings`、`convertOne`、像素下限 ×3、`updatePxHint`）
- Modify: `src/index.template.html:37,38,70`（min=1、单位文案、hint 追加——不提交）
- Modify: `tools/gen-e2e.js`（`convertRound` 增加 `smallRound` 参数 + 轮 4 调用）

**Interfaces:**
- Consumes: 现有 `currentSettings()` 返回 `{ targetKB, targetBytes, baseW, baseH, sizeW, sizeH, format, enhance, tolerance, minQ }`；`jpegToTarget(canvas, targetBytes, tolerance, targetKB, srcMaxEdge, minQ, onEnc)`；`pngToTarget(canvas, targetBytes, tolerance, physMaxCm, targetKB, srcMaxEdge, onEnc)`。
- Produces: `currentSettings()` 新增 `effTol` 字段（number，小目标放宽后的有效容差）；`minQ` 变为动态值（number）。后续任务依赖 `state.settings` 不变。

- [ ] **Step 1: e2e 驱动——`convertRound` 支持小目标轮（写失败测试）**

修改 `tools/gen-e2e.js`。先改签名与窗口计算（第 1 处，函数签名行）：

```js
      async function convertRound(targetKB, expectHitJpeg, keepList, smallRound = false) {
```

紧接着函数体内、`// 设置目标大小` 之前插入：

```js
        // 小目标（≤8KB）：有效容差 ±12%（与引擎 effTol 一致）
        const win = smallRound ? 0.12 : 0.02;
```

将 `const upper = targetKB * 1.02;` 替换为：

```js
        const upper = targetKB * (1 + win);
```

JPEG 命中判定替换为（`else if (jkb >= targetKB * 0.98)` 与 `else { jpegOk = jkb > 5;` 两行）：

```js
        else if (jkb >= targetKB * (smallRound ? 0.88 : 0.98)) { jpegOk = true; jpegMode = '精确命中'; }
        else { jpegOk = jkb > (smallRound ? 0.1 : 5); jpegMode = '受限（源分辨率/内容触顶，有效输出）'; }
```

PNG 低熵图判定替换为：

```js
        const bigHit = bigPhoto && isFinite(bigPhoto.kb) && bigPhoto.kb <= upper &&
          (smallRound ? true : bigPhoto.kb >= targetKB * 0.9);
```

低熵 JPEG 判定（`smoothHit`）中的 `smooth.kb > 25` 替换为 `smooth.kb > (smallRound ? 0.1 : 25)`。

小图源判定（`smallOk`）中的 `small.kb > 5` 替换为 `small.kb > (smallRound ? 0.1 : 5)`。

在 `await convertRound(256, ['photo-input.jpg'], false);`（轮 3）之后追加：

```js
      // 轮 4：1 KB（小目标下限：硬约束 ≤ 1.12KB、JPEG 命中 ~1KB、PNG 无损尽力而为）
      await convertRound(1, [], true, true);
```

（`keepList=true`：保留列表供 Task 2 的「下载全部」复用。）

- [ ] **Step 2: 运行 e2e，验证 1KB 轮失败（红）**

Run: `node tools/gen-e2e.js && node tools/e2e-run.js`（index.html 尚未改动，无需 build）
Expected: 现有轮（50/30/256KB）全部 PASS；1KB 轮 FAIL，典型失败行：
- `目标 1 KB：全部 ≤ 1.12 KB（超出: ...）`——实际输出 ~30KB（输入被 clamp 到 30）
- `目标 1 KB：JPEG 输入...（30 左右 KB，硬约束 ≤ 1.1）`
- `目标 1 KB：PNG 输入全部 ≤ 1.12 KB` FAIL

如出现 `页面 JS 错误` 且内容含 `ArchiveWasm` 相关字样——这是用户 WIP 的既有问题，记录后继续（本计划判定标准只针对 1KB 轮与现有轮）。

- [ ] **Step 3: 实现 app.js 参数调整（D1–D4）**

**D1（clamp ×2）：**

`src/app.js:539`：
```js
    $('#targetKB').addEventListener('change', (e) => { set('targetKB', clampNum(e.target.value, 30, 2048, 100)); updatePxHint(); });
```
→
```js
    $('#targetKB').addEventListener('change', (e) => { set('targetKB', clampNum(e.target.value, 1, 2048, 100)); updatePxHint(); });
```

`src/app.js:556`（`updatePxHint` 内 `const kb = clampNum(s.targetKB, 30, 2048, 100);`）→ `clampNum(s.targetKB, 1, 2048, 100)`。

**D2 + D3（`currentSettings`）：**

`src/app.js:45-59` 整体替换为：

```js
  function currentSettings() {
    const s = state.settings;
    const tolerance = Math.max(0.5, Math.min(15, s.tolerance)) / 100;
    return {
      targetKB: s.targetKB,
      targetBytes: Math.max(1, Math.round(s.targetKB * 1024)),
      baseW: cmToPx(s.sizeW, BASE_DPI), // 基准像素（仅定比例与演算起点）
      baseH: cmToPx(s.sizeH, BASE_DPI),
      sizeW: s.sizeW, // 物理尺寸（统一约束）
      sizeH: s.sizeH,
      format: s.format,
      enhance: !!s.enhance,
      tolerance,
      // 小目标（≤8KB）容差自动放宽至 ±12%：±2% 在 1KB 处只有 ±20B 窗口，二分搜索无法命中
      effTol: Math.max(tolerance, s.targetKB <= 8 ? 0.12 : 0),
      // 质量下限随目标缩小（1KB≈q30，≥21KB 回到 q90 与旧行为一致）：
      // 小屏贴片/缩略图场景 q30–40 观感可接受，且更低质量下限 → 二分可承载更高分辨率
      minQ: Math.min(90, Math.max(30, Math.round(30 + 3 * (s.targetKB - 1)))),
    };
  }
```

**D3（`convertOne` 全部 `s.tolerance` → `s.effTol`，共 6 处）：**

- `src/app.js:920` `pngToTarget(canvas, s.targetBytes, s.tolerance, ...)` → `s.effTol`
- `src/app.js:925` `const high = Math.min(s.targetBytes * (1 + s.tolerance), ...)` → `s.effTol`
- `src/app.js:935` `if (item.resultBlob.size < s.targetBytes * (1 - s.tolerance))` → `s.effTol`
- `src/app.js:941` `jpegToTarget(canvas, s.targetBytes, s.tolerance, ...)` → `s.effTol`
- `src/app.js:956` `encodeJpegMozBest(finalCanvas, r.q, s.targetBytes, s.tolerance, s.minQ)` → `s.effTol`
- `src/app.js:966` `else if (r.blob.size < s.targetBytes * (1 - s.tolerance))` → `s.effTol`

**D4（像素下限 48 → 16，共 3 处）：**

- `src/app.js:822` `let lo = 48, hi = base, foundRes = 48;` → `let lo = 16, hi = base, foundRes = 16;`
- `src/app.js:870` `let lo = 48, hi = upper;` → `let lo = 16, hi = upper;`
- `src/app.js:558-559`（`updatePxHint` 内两个 `Math.max(48, ...)`）→ `Math.max(16, ...)`

**D1 + D5（`src/index.template.html`，仅工作区，不提交）：**

- `:37` `min="30"` → `min="1"`
- `:38` `<span class="unit">KB（30 – 2048）</span>` → `<span class="unit">KB（1 – 2048）</span>`
- `:70` hint 段落末尾追加：`目标 ≤8KB 时大小容差自动放宽至 ±12%；PNG 小目标为无损尽力而为（内容受限时输出最大可达）。`

- [ ] **Step 4: 构建并运行 e2e，验证全绿**

Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js`
Expected: 全部轮 PASS，包括新增的 `目标 1 KB：全部 ≤ 1.12 KB`、`JPEG 输入精确命中/受限（~1 KB，硬约束 ≤ 1.1）`、`9/10 输出有效`。

- [ ] **Step 5: 提交**

```bash
git add src/app.js tools/gen-e2e.js
git commit -m "feat: 目标大小下限扩展至 1KB——动态质量下限（1KB≈q30）/小目标容差 ±12%/像素下限 16px + e2e 1KB 轮

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 「下载全部」逐张下载按钮（D6）+ e2e 校验（红→绿）

**Files:**
- Modify: `src/app.js`（`uniqueName`、`downloadAll`、`exportZip` 重构、`bindActions`、`updateButtons`）
- Modify: `src/index.template.html:91`（按钮，仅工作区，不提交）
- Modify: `tools/gen-e2e.js`（下载全部驱动段）
- Modify: `tools/e2e-run.js`（等待 + 校验逐张下载文件）

**Interfaces:**
- Consumes: Task 1 的 `state.items`（`status==='done'` 项含 `resultBlob`、`outName`）；现有 `downloadBlob(blob, filename)`；现有 `sanitizeZipName(name)`。
- Produces: `uniqueName(name, used)`（string, Set → string，_k 后缀去重，供 `exportZip` 与 `downloadAll` 共享）；`downloadAll()`（async，无返回）。

- [ ] **Step 1: e2e 驱动 + runner 校验（写失败测试）**

`tools/gen-e2e.js`：在轮 4（`await convertRound(1, [], true, true);`）之后追加：

```js
      // 10. 下载全部：直接逐张下载（不经 ZIP）——9 张完成图（坏文件跳过）
      {
        const dlBtn = document.querySelector('#btnDownloadAll');
        report(!!dlBtn, '下载全部按钮存在');
        if (dlBtn) {
          report(!dlBtn.disabled, '下载全部按钮可用（有完成项）');
          dlBtn.click();
          await tick(4000);
          report(true, '已触发下载全部（9 张：7 PNG + 2 JPEG，坏文件跳过）');
        }
        document.querySelector('#btnClearAll').click();
        await tick(200);
      }
```

`tools/e2e-run.js`：在 `for (let i = 0; i < 30; i++) { if (fs.readdirSync(dlDir).some((f) => f.endsWith('.zip'))) break; await sleep(500); }` 之后追加（仍在 try 内、浏览器关闭前等待落盘）：

```js
    // 等待「下载全部」逐张下载落盘（最多 30s）
    for (let i = 0; i < 60 && fs.readdirSync(dlDir).filter((f) => !f.endsWith('.zip')).length < 9; i++) {
      await sleep(500);
    }
```

`tools/e2e-run.js`：在 finally 块内、`if (zips.length) { ... }` ZIP 校验块之后追加：

```js
    const imgs = fs.readdirSync(dlDir).filter((f) => !f.endsWith('.zip'));
    console.log('=== 下载全部（逐张下载）校验 ===');
    console.log('文件数=' + imgs.length + '（期望 9：7 PNG + 2 JPEG，坏文件跳过）');
    const over = imgs.filter((f) => fs.statSync(path.join(dlDir, f)).size > 1147);
    console.log(imgs.length === 9 && over.length === 0
      ? '下载全部校验: PASS（9 张全部 ≤ 1.12KB）'
      : '下载全部校验: FAIL（' + (imgs.length !== 9 ? '期望 9 实际 ' + imgs.length : '超出 1.12KB: ' + over.join(', ')) + '）');
```

- [ ] **Step 2: 运行 e2e，验证失败（红）**

Run: `node tools/gen-e2e.js && node tools/e2e-run.js`（index.html 未含按钮）
Expected: 1KB 轮 PASS；`下载全部按钮存在` FAIL；runner 输出 `下载全部校验: FAIL（期望 9 实际 0）`。其余轮全部 PASS。

- [ ] **Step 3: 实现 app.js + template（D6）**

`src/app.js`：在 `sanitizeZipName` 定义之后、`exportZip` 之前插入：

```js
  // 文件名去重（_k 后缀；ZIP 导出与逐张下载共享）
  function uniqueName(name, used) {
    let uniq = name, k = 1;
    while (used.has(uniq)) {
      const dot = name.lastIndexOf('.');
      uniq = dot > 0 ? name.slice(0, dot) + '_' + k + name.slice(dot) : name + '_' + k;
      k++;
    }
    used.add(uniq);
    return uniq;
  }

  // ---------- 下载全部：直接逐张下载（不经 ZIP）----------
  // 跳过失败/未完成项；相邻间隔 ~120ms 防 Chrome 丢弃快速连续的程序化下载
  async function downloadAll() {
    const done = state.items.filter((i) => i.status === 'done');
    if (!done.length) return;
    const used = new Set();
    for (const item of done) {
      downloadBlob(item.resultBlob, uniqueName(item.outName, used));
      await new Promise((r) => setTimeout(r, 120));
    }
  }
```

`src/app.js` `exportZip`：将内联去重循环替换为共享函数（原 `let uniq = name; let k = 1; while (used.has(uniq)) {...} used.add(uniq);` 整段）：

```js
    for (const item of done) {
      let name = sanitizeZipName(keepTree ? item.relPath : item.name);
      const uniq = uniqueName(name, used);
      entries.push({ name: uniq, data: new Uint8Array(await item.resultBlob.arrayBuffer()) });
    }
```

`src/app.js` `bindActions`（`:1045-1052`）追加一行：

```js
    $('#btnDownloadAll').addEventListener('click', () => downloadAll());
```

`src/app.js` `updateButtons`（`:459-469`）追加一行：

```js
    $('#btnDownloadAll').disabled = !hasDone || state.converting;
```

`src/index.template.html:91`（`btnExportZip` 之后）：

```html
      <button type="button" class="btn accent" id="btnExportZip" disabled>下载 ZIP</button>
      <button type="button" class="btn" id="btnDownloadAll" disabled title="直接逐张下载全部转换后的图片（跳过失败项；首次会弹一次多文件下载确认）">下载全部</button>
```

- [ ] **Step 4: 构建并运行 e2e，验证全绿**

Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js`
Expected: 全部轮 PASS；`下载全部按钮存在/可用` PASS；runner 输出 `下载全部校验: PASS（9 张全部 ≤ 1.12KB）`；既有 ZIP 校验（树/平铺、≤51KB、photo-input 45–51KB 窗口）不受影响。

- [ ] **Step 5: 提交**

```bash
git add src/app.js tools/gen-e2e.js tools/e2e-run.js
git commit -m "feat: 新增「下载全部」逐张下载按钮（文件名去重 + 120ms 间隔防丢包）+ e2e 校验

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: README 文档 + 全量回归 + WIP 处理确认

**Files:**
- Modify: `README.md`（D5/D6 文案）
- 提交决策：`src/index.template.html`（含用户 WIP 的 AW_ESM 行）

**Interfaces:**
- Consumes: Task 1、Task 2 的产物（工作区状态）。

- [ ] **Step 1: README 更新**

`README.md:14`：
```markdown
   - **目标大小**（默认 50 KB，支持 30 KB – 2 MB）
```
→
```markdown
   - **目标大小**（默认 100 KB，支持 1 KB – 2 MB）
```

`README.md:19`（使用方法第 4 条）：
```markdown
4. 点击「开始转换」，完成后「下载 ZIP」批量导出（文件名与文件夹结构不变），也可单张下载
```
→
```markdown
4. 点击「开始转换」，完成后可「下载 ZIP」打包导出（文件名与文件夹结构不变）、「下载全部」逐张直接下载（跳过失败项），也可单张下载
```

`README.md` 输出规则节（`- **统一大小**` 之后）新增一条：
```markdown
- **小目标（≤8KB）**：大小容差自动放宽至 ±12%；JPEG 质量下限随目标缩小（1KB ≈ q30，≥21KB 回到 q90）；PNG 保持无损尽力而为，内容受限时输出最大可达（≤ 容差上限）
```

`README.md` 常见问题节新增一条：
```markdown
- **1KB 级 PNG 输出达不到目标大小**：PNG 为无损格式，仅极简单内容（纯色/渐变）能压到 1KB；照片类输出内容受限的最大可达值（≤ 容差上限），属正常现象
```

- [ ] **Step 2: 全量回归**

Run: `node --test tests/logic.test.js` → 全部 PASS（logic.js 未改动，回归确认）
Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js` → 全部轮 PASS + ZIP 校验 PASS + 下载全部校验 PASS

- [ ] **Step 3: 与用户确认 WIP 处理与最终提交**

向用户说明：`src/index.template.html` 含其 WIP 的 `<script><!--AW_ESM--></script>` 行（连同未跟踪的 `vendor/archive-esm.js`、`vendor/libarchive.wasm`，以及 build.js/index.html 的 archive-wasm 重集成）。给出选项：
1. 先单独提交 WIP（`wip: archive-wasm 重集成`），再提交 template 的本计划改动（推荐）；
2. 丢弃 WIP（恢复 `git checkout` 那 3 个文件并删除 vendor 两个文件），本计划改动照常提交；
3. 保持现状不提交（template 改动留在工作区）。

按用户选择执行后，提交 `src/index.template.html`（含本计划改动）与 `README.md`：

```bash
git add README.md src/index.template.html
git commit -m "docs: 1KB 目标与下载全部的使用说明；目标大小下限 1KB（template 输入与提示）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 4: 手工验证（浏览器）**

用 Edge/Chrome 打开构建后的 `index.html`：目标大小设为 1，导入一张照片（JPEG）与一张渐变图（PNG），转换后确认：
- JPEG 输出 ~0.9–1.1KB、PNG 输出 ≤1.1KB 或内容受限标注；
- 预览弹层显示 `px @ DPI` 元数据；
- 点「下载全部」逐张下载，文件名正确无重名（同名时 `_1` 后缀）。
