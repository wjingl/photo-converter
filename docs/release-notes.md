# photo-converter v1.1

图片批量转换（本地 · 零联网）：把任意图片或文件夹里的所有图片，统一转换为**相同物理尺寸、相同目标大小**的图片，适合 1.5cm 级小屏贴片/缩略图场景。

## v1.1 更新（ZIP 兼容性与国产化适配）

- **适配银河麒麟（Kylin）等国产化 Linux**：内置旧版 Firefox 内核的浏览器直接可用
- **ZIP 导入兼容性修复**：旧版 Firefox 不支持 `DecompressionStream('deflate-raw')`（构造即报错）——
  自动切换到内置纯 JS 解压器（支持 stored / fixed / 动态 Huffman 三种 block，与 node zlib 交叉验证），压缩包导入完整可用
- **ZIP 导出自动降级**：`deflate-raw` 压缩不可用时自动改为不压缩打包（store），ZIP 仍有效
- 解析失败报错附带**文件头 hex 诊断**，一眼定位压缩包真实格式

## 核心能力

- **单文件交付**：双击 `index.html` 即可使用，零安装、零依赖、纯本地（无任何网络请求）
- **目标大小 0.3KB – 2MB**：JPEG 精确命中目标（动态质量下限）；PNG 调色板量化（<0.8KB 8 色、0.8–25KB 16 色、25–50KB 32 色 + 有序抖动；>50KB 全彩无损）
- **小一寸模式**（勾选）：一键固定 64×89 像素输出（物理 2.2×3.2cm，忽略目标大小，取消恢复原设置；高级设置仍可选）
- **物理尺寸统一**：所有输出长宽严格一致，DPI 写入文件元数据（JPEG JFIF / PNG pHYs）
- **画质增强管线**：自动去噪 → 饱和增强（随色数自适应）→ 压缩后锐化
- **高级设置**（折叠栏）：饱和度增强 / 抖动强度 / 调色板色数手动覆盖（默认自动档）
- **多核并行**：量化/压缩编码运行在 Web Worker（4 路并发池）；Worker 不可用自动降级
- **导入**：拖入图片/文件夹 / 选择 / ZIP 压缩包（保留文件夹结构）
- **导出**：ZIP 打包（保留目录树）/ 「下载全部」逐张下载

## 平台

银河麒麟（Kylin）等国产化 Linux、Windows / Linux / Android 的 Chrome、Edge、Firefox 等现代浏览器（file:// 直接打开）。

## 使用

双击 `index.html` → 拖入或选择图片 → 设置目标大小与输出尺寸 → 开始转换 → 下载 ZIP 或逐张下载。

## 开发

```bash
node --test tests/logic.test.js   # 单元测试（43 条）
node build.js                     # 由 src/ 打包 index.html
node tools/gen-e2e.js && node tools/e2e-run.js   # 无头浏览器端到端（116 条断言）
```
