# 高级设置（饱和度/抖动/色数）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置区新增"高级设置"折叠栏：饱和度增强、抖动强度、调色板色数三参数用户可配置，自动档为默认（现有智能策略）。

**Architecture:** `ditherIndices` 加强度系数参数（默认 0.5 兼容）；`currentSettings` 加 override 逻辑；template 加高级栏；`window.__piState` 调试钩子供 e2e。

**Tech Stack:** 原生 JS、node:test、无头 Edge e2e。

## Global Constraints

- 零第三方依赖、`file://` 兼容、CSP 不变。
- 自动档行为 = 现有策略（<0.8KB 8 色、0.8–25KB 16 色、25–50KB 32 色、>50KB 全彩；饱和 0.25/0.22/0.12/0；抖动 255/色数×0.5）——默认值下所有 e2e 断言不变。
- 设置持久化（localStorage）；旧缓存兼容（缺失键保留默认）。
- 中文注释与文案；提交信息 `feat:/docs:` 前缀 + 中文 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- e2e 运行链：`node build.js` → `node tools/gen-e2e.js` → `node tools/e2e-run.js`；`index.html` 随 src 重建并提交。

---

### Task 1: logic.js 参数化 + app.js 设置逻辑 + UI（template 高级栏）

**Files:**
- Modify: `src/logic.js`（`ditherIndices` 加 `strengthFactor`）
- Modify: `src/app.js`（settings 默认、currentSettings override、pngToTarget 第 9 参、UI 绑定、调试钩子）
- Modify: `src/index.template.html`（高级折叠栏）

**Interfaces:**
- Consumes: 现有 `PI.ditherIndices(rgba, palette, w, h)`。
- Produces: `PI.ditherIndices(rgba, palette, w, h, strengthFactor = 0.5)`；`currentSettings()` 新增 `ditherFactor`；`window.__piState()` 返回 `{ settings }`。Task 2 依赖。

- [ ] **Step 1: logic.js `ditherIndices` 参数化**

`src/logic.js` 签名与 strength 行：

```js
  function ditherIndices(rgba, palette, w, h) {
    const n = w * h;
    const strength = 255 / Math.max(2, palette.length) * 0.5; // 随色数缩小；×0.5 颗粒温和（色带仍有效打破）
```
→
```js
  function ditherIndices(rgba, palette, w, h, strengthFactor = 0.5) {
    const n = w * h;
    const strength = 255 / Math.max(2, palette.length) * strengthFactor; // 随色数缩小；×0.5 颗粒温和（色带仍有效打破）
```

- [ ] **Step 2: settings 默认 + loadSettings 兜底**

`src/app.js` state.settings（:8）追加：

```js
    settings: { targetKB: 100, sizeW: 1.2, sizeH: 1.8, format: 'png', enhance: true, tolerance: 2, theme: 'auto',
      satAuto: true, satPct: 22, ditherAuto: true, ditherPct: 50, colorMode: 'auto' },
```

`loadSettings`（:19-24）在 Object.assign 后补兜底：

```js
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (s) Object.assign(state.settings, s);
      // 新字段兜底（旧缓存缺失时保持默认；undefined 会覆盖默认值）
      if (state.settings.satAuto === undefined) state.settings.satAuto = true;
      if (state.settings.ditherAuto === undefined) state.settings.ditherAuto = true;
      if (state.settings.colorMode === undefined) state.settings.colorMode = 'auto';
    } catch (e) { /* 忽略 */ }
  }
```

- [ ] **Step 3: currentSettings override 逻辑**

`src/app.js` currentSettings：

```js
    // 调色板量化：<0.8KB 8 色（极端低色数区间）、0.8–25KB 16 色（把 5-7KB 的好观感扩展到这里）、
    // 25–50KB 32 色、>50KB 全彩无损（现有行为不变）
    const paletteColors = s.targetKB <= 0.8 ? 8 : s.targetKB <= 25 ? 16 : s.targetKB <= 50 ? 32 : 0;
```
→
```js
    // 调色板量化：自动档 <0.8KB 8 色、0.8–25KB 16 色、25–50KB 32 色、>50KB 全彩；
    // 高级设置可覆盖（colorMode: 'auto'/'8'/'16'/'32'/'full'）
    const autoColors = s.targetKB <= 0.8 ? 8 : s.targetKB <= 25 ? 16 : s.targetKB <= 50 ? 32 : 0;
    const paletteColors = s.colorMode === 'auto' ? autoColors : s.colorMode === 'full' ? 0 : parseInt(s.colorMode, 10) || autoColors;
```

`satBoost` 行：

```js
      satBoost: paletteColors === 8 ? 0.25 : paletteColors === 16 ? 0.22 : paletteColors === 32 ? 0.12 : 0,
```
→
```js
      // 饱和增强：自动档随色数自适应（8 色 0.25 / 16 色 0.22 / 32 色 0.12 / 全彩 0）；
      // 高级设置可覆盖（satAuto=false 时用 satPct/100）
      satBoost: s.satAuto === false ? Math.min(0.5, (s.satPct || 0) / 100) :
        paletteColors === 8 ? 0.25 : paletteColors === 16 ? 0.22 : paletteColors === 32 ? 0.12 : 0,
      // 抖动强度系数：自动档 0.5（255/色数×0.5）；高级设置可覆盖（0 = 关闭抖动）
      ditherFactor: s.ditherAuto === false ? Math.min(1, (s.ditherPct || 0) / 100) : 0.5,
```

- [ ] **Step 4: pngToTarget 第 9 参（ditherFactor）**

`src/app.js` pngToTarget 签名（`... onEnc, colors = 0`）：

```js
  async function pngToTarget(canvas, targetBytes, tolerance, physMaxCm, targetKB, srcMaxEdge, onEnc, colors = 0) {
```
→
```js
  async function pngToTarget(canvas, targetBytes, tolerance, physMaxCm, targetKB, srcMaxEdge, onEnc, colors = 0, ditherFactor = 0.5) {
```

encode() 调色板分支：

```js
        const { palette } = PI.quantize(data.data, colors);
        const indices = PI.ditherIndices(data.data, palette, data.width, data.height);
```
→
```js
        const { palette, indices: rawIdx } = PI.quantize(data.data, colors);
        // 抖动强度系数：0 = 关闭（用量化原始索引）；>0 按系数（自动档 0.5）
        const indices = ditherFactor > 0 ? PI.ditherIndices(data.data, palette, data.width, data.height, ditherFactor) : rawIdx;
```

调用点（convertOne）加第 9 参：

```js
      const r = await pngToTarget(canvas, s.targetBytes, s.effTol, physMaxCm, s.targetKB, srcMaxEdge, onEnc, s.paletteColors);
```
→
```js
      const r = await pngToTarget(canvas, s.targetBytes, s.effTol, physMaxCm, s.targetKB, srcMaxEdge, onEnc, s.paletteColors, s.ditherFactor);
```

- [ ] **Step 5: 调试钩子（boot 末尾）**

`src/app.js` boot() 末尾追加：

```js
    // 调试/测试钩子（e2e 用）：暴露内部状态
    window.__piState = () => ({ settings: state.settings });
```

- [ ] **Step 6: template 高级折叠栏**

`src/index.template.html` 设置区 `</details>`（设置面板结束标签）之前、容差/主题字段之后插入：

```html
      <details id="advancedPanel" class="field">
        <summary>高级设置</summary>
        <label class="field check"><input type="checkbox" id="satAutoToggle" checked> 饱和度增强（自动跟随色数）
          <input type="range" id="satSlider" min="0" max="50" step="1" value="22" disabled>
          <span class="unit" id="satVal">22%</span>
        </label>
        <label class="field check"><input type="checkbox" id="ditherAutoToggle" checked> 抖动强度（自动随色数）
          <input type="range" id="ditherSlider" min="0" max="100" step="5" value="50" disabled>
          <span class="unit" id="ditherVal">50%</span>
        </label>
        <label class="field">调色板色数
          <select id="colorModeSelect">
            <option value="auto" selected>自动（随目标大小）</option>
            <option value="8">8 色（极限）</option>
            <option value="16">16 色</option>
            <option value="32">32 色</option>
            <option value="full">全彩无损</option>
          </select>
        </label>
      </details>
```

- [ ] **Step 7: app.js 设置 UI 绑定（renderSettings/bindSettings）**

`renderSettings`（:526-536）追加：

```js
    $('#satAutoToggle').checked = s.satAuto !== false;
    $('#satSlider').value = s.satPct || 22;
    $('#satSlider').disabled = s.satAuto !== false;
    $('#satVal').textContent = (s.satPct || 22) + '%';
    $('#ditherAutoToggle').checked = s.ditherAuto !== false;
    $('#ditherSlider').value = s.ditherPct || 50;
    $('#ditherSlider').disabled = s.ditherAuto !== false;
    $('#ditherVal').textContent = (s.ditherPct || 50) + '%';
    $('#colorModeSelect').value = s.colorMode || 'auto';
```

`bindSettings`（:537-546）追加：

```js
    $('#satAutoToggle').addEventListener('change', (e) => { set('satAuto', e.target.checked); $('#satSlider').disabled = e.target.checked; });
    $('#satSlider').addEventListener('input', (e) => { set('satPct', parseInt(e.target.value, 10) || 0); $('#satVal').textContent = e.target.value + '%'; });
    $('#ditherAutoToggle').addEventListener('change', (e) => { set('ditherAuto', e.target.checked); $('#ditherSlider').disabled = e.target.checked; });
    $('#ditherSlider').addEventListener('input', (e) => { set('ditherPct', parseInt(e.target.value, 10) || 0); $('#ditherVal').textContent = e.target.value + '%'; });
    $('#colorModeSelect').addEventListener('change', (e) => set('colorMode', e.target.value));
```

- [ ] **Step 8: 构建 + e2e 回归（自动档下断言不变）**

Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js`
Expected: 全部轮 PASS（默认设置 = 自动档 → 现有 99 断言不变）；PALETTE_OK 等校验 OK。

- [ ] **Step 9: 提交**

```bash
git add src/logic.js src/app.js src/index.template.html index.html
git commit -m "feat: 高级设置——饱和度/抖动/色数可配置（自动档默认）+ ditherIndices 强度参数化

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: e2e 高级设置断言 + 文案 + 全量回归

**Files:**
- Modify: `tools/gen-e2e.js`（高级栏断言 + override 生效验证）
- Modify: `README.md`（高级设置说明）

**Interfaces:**
- Consumes: Task 1 的 `window.__piState()`、`#advancedPanel` 等控件 id。

- [ ] **Step 1: e2e 断言段**

`tools/gen-e2e.js` 在启动自测段（`PI 完整性自测`）之后插入：

```js
      // 高级设置：折叠栏存在 + 覆盖生效（钩子验证）
      {
        const panel = document.querySelector('#advancedPanel');
        report(!!panel && panel.open === false, '高级设置折叠栏存在且默认收起');
        report(document.querySelector('#satAutoToggle').checked && document.querySelector('#ditherAutoToggle').checked,
          '饱和度/抖动默认自动档');
        const modeSel = document.querySelector('#colorModeSelect');
        modeSel.value = '8';
        modeSel.dispatchEvent(new Event('change', { bubbles: true }));
        const st = window.__piState && window.__piState();
        report(!!st && st.settings.colorMode === '8', '色数覆盖为 8 色（__piState 钩子生效）');
        modeSel.value = 'auto';
        modeSel.dispatchEvent(new Event('change', { bubbles: true }));
        report(window.__piState().settings.colorMode === 'auto', '色数恢复自动档');
      }
```

- [ ] **Step 2: README**

`README.md` 使用方法第 3 条（`- **输出格式**` 之后）追加：

```markdown
   - **高级设置**（折叠栏）：饱和度增强、抖动强度、调色板色数——默认自动（跟随目标大小智能适配），取消自动后可手动调整
```

- [ ] **Step 3: 全量回归**

Run: `node --test tests/logic.test.js` → 40 个 PASS（ditherIndices 默认参数向后兼容）
Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js` → 全部 PASS + 校验 OK

- [ ] **Step 4: 提交**

```bash
git add tools/gen-e2e.js README.md index.html
git commit -m "docs: 高级设置 e2e 断言与使用说明

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: 手工浏览器验证**

打开 `index.html`：高级设置折叠栏；取消"自动"后滑杆可调（饱和 30% / 抖动 80%）；色数强制 8 色后 25KB 目标输出明显更小（量化更狠）；刷新页面设置保留。
