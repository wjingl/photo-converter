# 0.1KB 目标下限 + 极端区间 8 色 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 目标下限扩展至 0.1KB；8 色调色板收窄至 ≤0.8KB（0.1KB 级用 4 色）；JPEG 物理下限提示。

**Architecture:** UI 层（template min/step + app.js clamp）+ 策略层（`currentSettings` 的 paletteColors 梯度、png/jpeg 像素下限）+ e2e 0.1KB 独立轮。

**Tech Stack:** 原生 JS、node:test、无头 Edge e2e。

## Global Constraints

- 零第三方依赖、`file://` 兼容、CSP 不变。
- 硬约束：≤8KB 目标 PNG 输出 ≤ `目标×(1+12%)`（0.1KB → ≤114B，4 色 3×3 ≈ 113B 命中）。
- JPEG ≤0.5KB 物理不可达（最小 ~200B）→ 允许超窗，note 标注"物理下限"。
- >8KB 目标完全不变。
- 中文注释与文案；提交信息 `feat:/docs:` 前缀 + 中文 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- e2e 运行链：`node build.js` → `node tools/gen-e2e.js` → `node tools/e2e-run.js`；`index.html` 随 src 重建并提交。

---

### Task 1: 0.1KB 下限 + 梯度/像素调整 + e2e 0.1KB 轮（红→绿）

**Files:**
- Modify: `src/index.template.html:37,38`（min/step/单位文案）
- Modify: `src/app.js`（clamp ×2；paletteColors 梯度；pngToTarget/jpegToTarget 下限）
- Modify: `tools/gen-e2e.js`（0.1KB 独立轮）

**Interfaces:**
- Consumes: 现有 `convertRound(targetKB, expectHitJpeg, keepList, smallRound)`、`importFiles`、`makeFixtureFiles`、`parseKB`、`waitUntil`。
- Produces: `paletteColors = targetKB <= 0.2 ? 4 : targetKB <= 0.8 ? 8 : targetKB <= 4 ? 16 : targetKB <= 8 ? 32 : 0`；png 下限 3、jpeg 下限 8。Task 2 依赖 note 语义。

- [ ] **Step 1: e2e 驱动——0.1KB 独立轮（写失败测试）**

`tools/gen-e2e.js` 在轮 4（`await convertRound(1, [], true, true);`）之后、`// 9.5.` 诊断段之前插入：

```js
      // 轮 5：0.1 KB（极端下限：4 色 3×3px ≈ 113B；JPEG 物理下限 ~200B 起，允许超窗并标注）
      {
        const kbInput = document.querySelector('#targetKB');
        kbInput.value = 0.1;
        kbInput.dispatchEvent(new Event('change', { bubbles: true }));
        const files = await makeFixtureFiles();
        await importFiles(files);
        document.querySelector('#btnConvert').click();
        const finished = await waitUntil(
          () => {
            const sts = document.querySelectorAll('.file-row .status');
            return sts.length > 0 && Array.from(sts).every((s) => s.textContent === '完成' || s.textContent === '失败');
          },
          180000, '0.1KB 转换完成'
        );
        report(finished, '目标 0.1 KB：转换全部完成');
        const sizes = [];
        for (const row of document.querySelectorAll('.file-row')) {
          const name = row.querySelector('.name').textContent;
          const status = row.querySelector('.status').textContent;
          sizes.push({ name, status, kb: parseKB(row.querySelector('.result').textContent), resultTxt: row.querySelector('.result').textContent });
        }
        const anyFail = sizes.filter((s) => s.status === '失败');
        report(anyFail.length === 1 && anyFail[0].name === 'bad-input.jpg', '目标 0.1 KB：仅坏文件失败');
        // PNG：硬约束 ≤ 0.114KB（4 色 3×3 ≈ 113B 命中窗口）
        const pngs = sizes.filter((s) => s.name.endsWith('.png') && isFinite(s.kb));
        const pngOver = pngs.filter((s) => s.kb > 0.114);
        report(pngOver.length === 0, '目标 0.1 KB：PNG 全部 ≤ 0.114KB（超出: ' + JSON.stringify(pngOver) + '）');
        // JPEG：允许超窗，note 必须含"物理下限"
        const jpegs = sizes.filter((s) => /\.jpg$/.test(s.name) && isFinite(s.kb));
        const jpegNote = jpegs.length === 2 && jpegs.every((s) => (s.resultTxt || '').includes('物理下限'));
        report(jpegNote, '目标 0.1 KB：JPEG 标注物理下限（' + jpegs.map((s) => s.kb + 'KB').join(', ') + '）');
        document.querySelector('#btnClearAll').click();
        await tick(200);
      }
```

- [ ] **Step 2: 运行 e2e 验证红**

Run: `node tools/gen-e2e.js && node tools/e2e-run.js`（index.html 未改）
Expected: 0.1KB 轮 FAIL——`kbInput.value = 0.1` 被 clamp 到 1KB → PNG 输出 ~1KB > 0.114KB（`目标 0.1 KB：PNG 全部 ≤ 0.114KB` FAIL）、JPEG 无"物理下限" note（`目标 0.1 KB：JPEG 标注物理下限` FAIL）。现有轮全部 PASS。

- [ ] **Step 3: 实现 D1–D3（template + app.js）**

`src/index.template.html:37`：
```html
        <input type="number" id="targetKB" min="1" max="2048" step="1" value="100">
        <span class="unit">KB（1 – 2048）</span>
```
→
```html
        <input type="number" id="targetKB" min="0.1" max="2048" step="0.1" value="100">
        <span class="unit">KB（0.1 – 2048）</span>
```

`src/app.js` `bindSettings` 的 clamp：
```js
    $('#targetKB').addEventListener('change', (e) => { set('targetKB', clampNum(e.target.value, 1, 2048, 100)); updatePxHint(); });
```
→ `clampNum(e.target.value, 0.1, 2048, 100)`

`src/app.js` `updatePxHint` 的 clamp：
```js
    const kb = clampNum(s.targetKB, 1, 2048, 100);
```
→ `clampNum(s.targetKB, 0.1, 2048, 100)`

`src/app.js` `currentSettings` 的 `paletteColors`：
```js
      paletteColors: s.targetKB <= 2 ? 8 : s.targetKB <= 4 ? 16 : s.targetKB <= 8 ? 32 : 0,
```
→
```js
      // 小目标自动调色板量化：≤0.2KB 4 色（0.1KB 物理必需：8 色固定开销 93B 装不下 114B 窗口）、
      // ≤0.8KB 8 色（极端低色数区间）、≤4KB 16 色、≤8KB 32 色、>8KB 全彩无损
      paletteColors: s.targetKB <= 0.2 ? 4 : s.targetKB <= 0.8 ? 8 : s.targetKB <= 4 ? 16 : s.targetKB <= 8 ? 32 : 0,
```

`src/app.js` `pngToTarget` 二分下限：
```js
    let lo = 16, hi = upper;
```
→ `let lo = 3, hi = upper;`（0.1KB 需 4 色 3×3px）

`src/app.js` `jpegToTarget` 下限：
```js
    let lo = 16, hi = base, foundRes = 16;
```
→ `let lo = 8, hi = base, foundRes = 8;`（JPEG 最小块 8×8）

- [ ] **Step 4: 构建 + e2e 验证绿**

Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js`
Expected: 全部轮 PASS——0.1KB 轮：PNG ≤ 0.114KB（4 色 3×3 ≈ 113B）、JPEG 物理下限 note 存在（Task 1 阶段 note 尚未实现则此断言仍 FAIL——**Step 5 实现 note 后复跑**）。

- [ ] **Step 5: 实现 JPEG 物理下限 note（app.js convertOne JPEG 分支）**

`src/app.js` JPEG 分支 note 链（`if (r.edge > baseEdge) item.note = 'DPI 升至...` 之前）插入：

```js
      if (item.resultBlob.size > s.targetBytes * (1 + s.effTol)) {
        item.note = 'JPEG 物理下限（~0.2KB 起），已输出最小可达';
      } else if (r.edge > baseEdge) {
```

- [ ] **Step 6: 构建 + e2e 全绿**

Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js`
Expected: 全部轮 PASS（含 0.1KB 轮两条断言）；PALETTE_OK、下载校验、ZIP 校验 OK。

- [ ] **Step 7: 提交**

```bash
git add src/app.js src/index.template.html tools/gen-e2e.js index.html
git commit -m "feat: 目标下限 0.1KB + 极端区间（≤0.8KB 8 色 / ≤0.2KB 4 色）+ JPEG 物理下限提示

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 文案 + 全量回归 + 提交

**Files:**
- Modify: `src/index.template.html:70`、`README.md`

- [ ] **Step 1: hint 文案**

`src/index.template.html:70` 小目标句子后追加：

```
0.1–0.8KB 为极端小目标：8 色（0.2KB 以下 4 色）极限压缩；JPEG 最小约 0.2KB，低于时输出最小可达并标注。
```

- [ ] **Step 2: README**

- `README.md` 目标大小行：`（默认 100 KB，支持 1 KB – 2 MB）` → `（默认 100 KB，支持 0.1 KB – 2 MB）`
- 小目标条目末尾追加：`；0.1–0.8KB 用 8 色（0.2KB 以下 4 色）；JPEG 物理下限 ~0.2KB，低于时输出最小可达并标注`
- 常见问题追加：`- **JPEG 目标低于 0.2KB 输出偏大**：JPEG 格式有不可压缩的表开销（最小约 0.2KB），低于该目标时输出最小可达并标注"物理下限"，属格式限制`

- [ ] **Step 3: 全量回归**

Run: `node --test tests/logic.test.js` → 40 个 PASS
Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js` → 全部 PASS + 校验 OK

- [ ] **Step 4: 提交**

```bash
git add README.md src/index.template.html index.html
git commit -m "docs: 0.1KB 目标与极端区间说明（hint + README）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: 手工浏览器验证**

目标 0.1 KB 转一张照片：PNG 输出 ~3×3px ≈ 0.11KB（4 色）、JPEG 输出最小可达并显示"物理下限"标注；预览弹层 px 元数据正常。
