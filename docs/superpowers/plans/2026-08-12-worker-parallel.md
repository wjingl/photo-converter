# 转换管线 Worker 化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 量化/抖动/deflate 编码搬入 Web Worker（多核真并行），主线程保留解码/缩放/二分骨架；Worker 不可用时自动降级同步（功能等价）。

**Architecture:** build.js 把 `logic.js` + Worker 入口内联为 `#workerSrc`；app.js 懒创建 Worker 池（≤4，轮转分配），`pngToTarget` 的 `encode()` 改为 Worker 优先 + 同步降级；CSP 加 `worker-src blob:`。

**Tech Stack:** 原生 JS、Web Worker + Blob URL、node:test、无头 Edge e2e。

## Global Constraints

- 零第三方依赖、`file://` 兼容；CSP 追加 `worker-src blob:`（不破坏现有约束）。
- **功能等价**：Worker 路径输出与主线程同步路径完全一致（同一 logic.js 代码）——现有 105 条 e2e 断言必须全部原样通过。
- 降级保障：Worker 创建失败/编码抛错 → 主线程同步编码（不中断批处理）。
- 中文注释与文案；提交信息 `feat:/docs:` 前缀 + 中文 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- e2e 运行链：`node build.js` → `node tools/gen-e2e.js` → `node tools/e2e-run.js`；`index.html` 随 src 重建并提交。

---

### Task 1: Worker 实现（build.js + template + app.js）

**Files:**
- Modify: `build.js`（`<!--WORKER_SRC-->` 注入）
- Modify: `src/index.template.html`（`#workerSrc` 标签 + CSP）
- Modify: `src/app.js`（Worker 池 + workerEncode + encode() 改造 + encodeSync 降级）

**Interfaces:**
- Produces: `#workerSrc` script 内容（logic.js + Worker 入口）；`workerEncode(width, height, rgba, colors, ditherFactor, phys) -> Promise<{bytes, size}>`（失败 reject）。Task 2 的 e2e 依赖 `#workerSrc` 存在。

- [ ] **Step 1: 确认 logic.js 不含 `</script>` 或 `<!--` 子串（HTML 内联安全）**

Run: `grep -c "</script>\|<!--" src/logic.js`
Expected: 输出 0（否则需转义方案——`</script>` 需 `<\/script>` 替换）。

- [ ] **Step 2: build.js 注入 Worker 源码**

`build.js` 在 `html = html.replace('<!--LOGIC-->', ...)` 之前插入：

```js
// Worker 并行编码脚本：logic.js（UMD）+ 入口（quantize/dither/encodePng，供 #workerSrc）
const WORKER_ENTRY = `
;(function () {
  'use strict';
  self.onmessage = async (e) => {
    const { id, cmd, width, height, rgba, colors, ditherFactor, phys } = e.data || {};
    try {
      if (cmd !== 'encode') throw new Error('unknown cmd: ' + cmd);
      const data = new Uint8ClampedArray(rgba);
      let bytes;
      if (colors > 0) {
        const q = self.PI.quantize(data, colors);
        const indices = ditherFactor > 0 ? self.PI.ditherIndices(data, q.palette, width, height, ditherFactor) : q.indices;
        bytes = await self.PI.encodePng({ width, height, rgba: data, indices, palette: q.palette, mode: 'palette', phys });
      } else {
        let hasAlpha = false;
        for (let i = 3; i < data.length; i += 4) { if (data[i] !== 255) { hasAlpha = true; break; } }
        bytes = await self.PI.encodePng({ width, height, rgba: data, mode: hasAlpha ? 'rgba' : 'rgb', phys });
      }
      self.postMessage({ id, bytes: bytes.buffer, size: bytes.length }, [bytes.buffer]);
    } catch (err) {
      self.postMessage({ id, error: String(err && err.message || err) });
    }
  };
})();
`;
html = html.replace('/*WORKER_SRC*/', read('src/logic.js') + '\n' + WORKER_ENTRY);
```

- [ ] **Step 3: template——`#workerSrc` 标签 + CSP**

`src/index.template.html` CSP meta（:9）追加 `worker-src blob;`：

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src blob:">
```

（注意 `worker-src blob:` 后不加分号——meta content 里用 `;` 分隔各指令，追加时保持语法一致。）

`src/index.template.html` 在 `<script><!--LOGIC--></script>` 之前插入：

```html
<script id="workerSrc">/*WORKER_SRC*/</script>
```

- [ ] **Step 4: app.js——Worker 池 + workerEncode**

`src/app.js` 在 `// ---------- oxipng` 段之前插入：

```js
  // ---------- Worker 并行编码（量化/抖动/deflate 多核并行）----------
  // 懒创建 Worker 池（≤4 个，与并发路数对齐，轮转分配）；创建失败/编码抛错 → 调用方降级同步
  let workerPool = null;
  let workerMsgId = 0;
  function getPiWorker() {
    if (!workerPool) {
      try {
        const srcEl = document.getElementById('workerSrc');
        const src = srcEl && srcEl.textContent.trim();
        if (!src || typeof Worker === 'undefined') { workerPool = { ok: false }; return null; }
        workerPool = { ok: true, blob: new Blob([src], { type: 'text/javascript' }), list: [], next: 0 };
      } catch (e) { workerPool = { ok: false }; return null; }
    }
    if (!workerPool.ok) return null;
    if (workerPool.next >= workerPool.list.length) {
      if (workerPool.list.length >= 4) {
        return workerPool.list[workerPool.next++ % workerPool.list.length]; // 池满 → 轮转复用
      }
      try { workerPool.list.push(new Worker(URL.createObjectURL(workerPool.blob))); }
      catch (e) { workerPool.ok = false; return null; }
    }
    return workerPool.list[workerPool.next++];
  }
  function workerEncode(width, height, rgba, colors, ditherFactor, phys) {
    return new Promise((resolve, reject) => {
      const w = getPiWorker();
      if (!w) return reject(new Error('Worker 不可用'));
      const id = ++workerMsgId;
      const onMsg = (e) => {
        if (!e.data || e.data.id !== id) return;
        w.removeEventListener('message', onMsg);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve({ bytes: new Uint8Array(e.data.bytes), size: e.data.size });
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ id, cmd: 'encode', width, height, rgba, colors, ditherFactor, phys }, [rgba.buffer]);
    });
  }
```

- [ ] **Step 5: app.js——encode() 改造（Worker 优先 + 同步降级）**

`src/app.js` `pngToTarget` 的 `encode` 函数整体替换（现含 hasAlpha 检测 + colors 分支）：

```js
    // 主线程同步编码（Worker 不可用/失败时降级）——与 Worker 路径同一 logic.js，输出一致
    const encodeSync = async (data, phys) => {
      let hasAlpha = false;
      for (let i = 3; i < data.data.length; i += 4) {
        if (data.data[i] !== 255) { hasAlpha = true; break; }
      }
      if (colors > 0) {
        const q = PI.quantize(data.data, colors);
        const indices = ditherFactor > 0 ? PI.ditherIndices(data.data, q.palette, data.width, data.height, ditherFactor) : q.indices;
        const bytes = await PI.encodePng({
          width: data.width, height: data.height,
          rgba: data.data, indices, palette: q.palette, mode: 'palette', phys,
        });
        return { bytes, phys };
      }
      const bytes = await PI.encodePng({
        width: data.width, height: data.height,
        rgba: data.data, mode: hasAlpha ? 'rgba' : 'rgb', phys,
      });
      return { bytes, phys };
    };
    const encode = async (c) => {
      if (onEnc) onEnc();
      const data = getData(c);
      const phys = dpiFromPx(Math.max(c.width, c.height), physMaxCm);
      // Worker 并行优先；失败（不可用/异常）→ 主线程同步降级，不中断批处理
      try {
        const r = await workerEncode(data.width, data.height, data.data, colors, ditherFactor, phys);
        return { bytes: r.bytes, phys };
      } catch (e) {
        return encodeSync(data, phys);
      }
    };
```

- [ ] **Step 6: 构建 + 单测 + e2e 全绿（功能等价）**

Run: `node build.js` → 确认 `index.html` 含 `id="workerSrc"` 且内容包含 `self.onmessage`。
Run: `node --test tests/logic.test.js` → 40 PASS（logic.js 未改）
Run: `node tools/gen-e2e.js && node tools/e2e-run.js` → 全部 PASS（105+ 条）+ 校验 OK——Worker 路径与同步路径输出一致。

- [ ] **Step 7: 提交**

```bash
git add build.js src/app.js src/index.template.html index.html
git commit -m "feat: 转换管线 Worker 化——量化/抖动/deflate 多核并行（Worker 池 4 路 + 同步降级）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: e2e Worker 验证 + 文案 + 回归

**Files:**
- Modify: `tools/gen-e2e.js`（Worker 往返断言）
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 的 `#workerSrc`。

- [ ] **Step 1: e2e——Worker 脚本存在 + 真实编码往返**

`tools/gen-e2e.js` 在高级设置断言段之后插入：

```js
      // Worker 并行编码：脚本内联存在 + 真实往返（quantize+dither+encodePng 全链路）
      {
        const srcEl = document.getElementById('workerSrc');
        report(!!srcEl && srcEl.textContent.trim().length > 1000,
          'Worker 脚本内联存在（' + (srcEl ? srcEl.textContent.trim().length : 0) + ' B）');
        let wRound = '无';
        try {
          const src = srcEl.textContent.trim();
          const blob = new Blob([src], { type: 'text/javascript' });
          const wkr = new Worker(URL.createObjectURL(blob));
          wRound = await new Promise((res) => {
            wkr.onmessage = (e) => res(e.data);
            const w = 8, h = 8;
            const rgba = new Uint8ClampedArray(w * h * 4);
            for (let i = 0; i < rgba.length; i++) rgba[i] = i % 4 === 3 ? 255 : (i * 7) % 256;
            wkr.postMessage({ id: 1, cmd: 'encode', width: w, height: h, rgba, colors: 8, ditherFactor: 0.5, phys: 300 }, [rgba.buffer]);
          });
          wkr.terminate();
        } catch (e) { wRound = 'ERR:' + String(e).slice(0, 120); }
        report(!!wRound && wRound.size > 0 && !wRound.error,
          'Worker 编码往返成功（' + (wRound && wRound.size || 0) + ' B' + (wRound && wRound.error ? ' err=' + wRound.error : '') + '）');
      }
```

- [ ] **Step 2: README 开发说明**

`README.md` 开发节（源文件说明行）追加：

```markdown
转换管线使用 Web Worker 并行（量化/抖动/deflate 编码多核并行，主线程负责解码与缩放；Worker 不可用时自动降级同步）。
```

- [ ] **Step 3: 全量回归**

Run: `node --test tests/logic.test.js` → 40 PASS
Run: `node build.js && node tools/gen-e2e.js && node tools/e2e-run.js` → 全部 PASS + 校验 OK（含 Worker 往返断言）

- [ ] **Step 4: 提交**

```bash
git add tools/gen-e2e.js README.md index.html
git commit -m "docs: Worker 并行 e2e 验证（往返全链路）与开发说明

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: 手工浏览器验证**

打开 `index.html` 导入 20 张大图转 50KB：对比改造前后批量耗时（预期量化路径显著提速）；任务管理器观察多核利用。Worker 不可用的旧浏览器（如有）应自动降级且功能正常。
