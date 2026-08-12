# 转换管线 Worker 化设计（量化/抖动/deflate 多核并行）

日期：2026-08-12
状态：已批准

## 背景

批量转换的并行现状：解码（createImageBitmap）与 deflate（CompressionStream）在浏览器
内部线程真并行，e2e 已锁定 4 路并发。但**量化（k-means 8 轮）+ 抖动 + deflate 编码**
是批量转换最大的 JS 计算量（每张图二分 6–10 轮 × 每轮全像素遍历），全部在主线程排队
（伪并行）。GPU 无收益场景（像素处理都在 ≤50KB 目标的小图上，上传开销 > 计算）。

## 设计决策

### D1 范围切分（控制风险）

| 环节 | 位置 | 理由 |
|---|---|---|
| 解码 / 缩放（drawImage）/ getImageData | 主线程 | GPU 加速；OffscreenCanvas 改造成本高风险大 |
| 二分搜索循环骨架 | 主线程 | 结构不变，每轮缩放后把 ImageData **transfer** 给 Worker |
| **量化 + 抖动 + deflate 编码** | **Web Worker** | 纯 JS 计算（logic.js），多核真并行 |
| JPEG 编码（toBlob） | 浏览器内部线程 | 已真并行，不搬 |
| mozjpeg/oxipng WASM | 主线程 | 全彩路径（>50KB）才用；避免 WASM glue 进 Worker 的复杂度 |

### D2 Worker 脚本（build.js 注入 + blob URL）

- Worker 源码 = `src/logic.js`（UMD，挂 `self.PI`）+ 入口代码，build.js 内联为
  `<script id="workerSrc"><!--WORKER_SRC--></script>`；
- app.js 用 `document.getElementById('workerSrc').textContent` → `Blob` →
  `new Worker(URL.createObjectURL(blob))`（file:// 兼容）；
- **CSP 追加 `worker-src blob:`**（当前 `script-src 'unsafe-inline' 'wasm-unsafe-eval'` 不含 blob:，
  会阻止 blob Worker）。

### D3 消息协议

主线程 → Worker：`{ id, cmd:'encode', width, height, rgba: Uint8ClampedArray(transfer), colors, ditherFactor, phys }`
Worker → 主线程：`{ id, bytes: ArrayBuffer(transfer), size }` 或 `{ id, error }`

Worker 内逻辑（与主线程现有 encode 等价）：
- `colors > 0`：`quantize` → `ditherIndices`（ditherFactor>0 时）→ `encodePng(palette)`；
- `colors = 0`：alpha 检测 → `encodePng(rgb/rgba)`。

### D4 主线程封装与降级

- `workerEncode(req)`：postMessage + await 匹配 id；transfer `rgba.buffer`（零拷贝）；
- **Worker 池**：lazy 创建，最多 4 个（与 CONCURRENCY 对齐），轮转分配；
- **降级**：Worker 创建失败（旧浏览器/CSP 阻止/file:// 异常）或编码抛错 →
  **回退主线程同步编码**（现有代码保留为 fallback）——功能等价，仅并行性损失；
- 取消：轮任务短，忽略迟到结果即可；进度 onEnc 回传不变（主线程每轮 await 后调用）。

### D5 测试与文档

- e2e：现有 105 条断言全部保留（功能等价验证）；
  新增诊断断言：`workerSrc` 存在、一次 Worker 编码往返成功（或诊断性报告降级）；
- 单测：logic.js 不动（Worker 复用同一文件，40 单测回归）；
- README：开发说明补 Worker 架构一句。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `build.js` | D2：`<!--WORKER_SRC-->` 注入（logic.js + worker 入口） |
| `src/index.template.html` | D2：workerSrc script 标签；D2：CSP `worker-src blob:` |
| `src/app.js` | D4：worker 池 + workerEncode + encode() 改造（worker 优先、同步降级） |
| `tools/gen-e2e.js` | D5：Worker 诊断断言 |
| `README.md` | D5 |
| `docs/superpowers/specs/2026-08-12-worker-parallel-design.md` | 本文档 |

不需要改动：`src/logic.js`、`src/style.css`、`tools/e2e-run.js`。
