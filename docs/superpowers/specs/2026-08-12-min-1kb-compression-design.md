# 压缩目标下限扩展至 ~1KB 设计

日期：2026-08-12
状态：已批准

## 背景

图片批量转换（单文件零依赖 HTML 应用）当前目标大小范围为 **30 KB – 2048 KB**。
需求：支持将图片压缩至 **最低约 1 KB**（"1kb 左右"）。用途为小屏贴片/缩略图展示（1.5cm 级小屏），
1KB 级图片以 q30–40 的低质量压缩即可满足观感。

## 目标与非目标

目标：
- 目标大小输入下限从 30 KB 降至 1 KB。
- 1KB 目标下 JPEG 能真实命中"约 1KB"（900–1147B 窗口）。
- PNG 保持无损原则，1KB 下尽力而为（简单内容可达，照片类输出内容受限的最大可达）。
- 常见目标（≥21KB）行为与现状完全一致。
- 新增「下载全部」按钮：直接逐张下载所有转换后的图片（不经 ZIP）。

非目标（用户已明确排除）：
- PNG 调色板量化（有损）——否决。
- 小目标预设快捷按钮（YAGNI）。
- 下载全部走文件夹写入（showDirectoryPicker）——否决，选逐个自动下载。
- 改变物理尺寸、裁剪规则、DPI 演算逻辑。

## 现状障碍（4 处）

1. UI 下限 30KB：`src/index.template.html:37`（`min="30"`）、`src/app.js:539` 与 `:556`（`clampNum(..., 30, 2048, ...)`）。
2. JPEG 质量下限固定 q90（`src/app.js:57` `minQ: 90`）：48×48@q90 ≈ 2–4KB，1KB 目标物理上不可能。
3. 像素下限 48px（`jpegToTarget` 的 `foundRes=48` 与二分起点、`pngToTarget` 的 `lo=48`）：
   - PNG 48×48 照片 ≈ 3–5KB > 1KB 上限 → **会违反硬约束**（二分搜索在 hi 降到 48 时退出，输出 48px 超限值）。
   - JPEG 48px@q90 ≈ 2–4KB > 1KB 上限。
4. 容差 ±2% 在 1KB 处窗口仅 ±20B，二分搜索无法命中（`MAX_ABS_ERR=5000` 在 1KB 处由百分比主导）。

## 设计决策

### D1 目标大小下限：30 → 1 KB

- `src/index.template.html:37`：`min="30"` → `min="1"`，单位文案 `KB（30 – 2048）` → `KB（1 – 2048）`。
- `src/app.js:539`（`bindSettings`）与 `:556`（`updatePxHint`）：`clampNum(e.target.value, 30, 2048, 100)` → `clampNum(e.target.value, 1, 2048, 100)`。
- 上限 2048 不变。设置持久化无需迁移（旧缓存值 ≥30 均合法）。

### D2 JPEG 质量下限动态化

`currentSettings()` 中 `minQ` 由固定 90 改为：

```
minQ = clamp(30 + 3 × (targetKB − 1), 30, 90)
```

| 目标大小 | minQ |
|---|---|
| 1 KB | 30 |
| 5 KB | 42 |
| 8 KB | 51 |
| 15 KB | 72 |
| ≥21 KB | 90（与现状一致） |

- 含义：分辨率二分搜索中"质量下限"越低 → 可承载更高分辨率 → 小屏观感更优（块效应被小尺寸掩盖）。
- `encodeJpegMozBest` 已通过参数接收 `minQ`，自动同步。
- 更新 `currentSettings` 中 `minQ: 90` 的注释（不再"固定"）。

### D3 小目标容差自动放宽

```
effTol = max(用户容差, targetKB ≤ 8 ? 0.12 : 0)
```

- 在 `currentSettings()` 计算一次，替换 `jpegToTarget`/`pngToTarget` 的 `tolerance` 入参与 `convertOne` 中的 note 判断、`encodeJpegMozBest` 调用。
- 1KB 目标有效窗口：`[max(0.88K, K−5K), min(1.12K, K+5K)]` = **900–1147B**（247B 窗口，q 粒度 1 档 ±2–4% ≈ 20–40B，可命中）。
- >8KB 目标：`effTol` 回落到用户容差，现有 ±2%/5KB 逻辑零变化。

### D4 像素下限 48 → 16px

- `jpegToTarget`：`let lo = 48, hi = base, foundRes = 48;` → 16。
- `pngToTarget`：二分 `let lo = 48` → 16。
- `updatePxHint` 的 `Math.max(48, …)` → 16（提示与演算一致）。
- 可行性核算：
  - PNG 16×16 RGB raw = 16×(1+16×3) = 784B，最坏（不可压缩噪声）deflate ≈ 810B，总 ≈ 0.85–1.1KB ≤ 1147B ✓（消除 D 障碍 3 的超限风险）。
  - JPEG 16px@q30 ≈ 0.4–0.7KB ✓。
- `startPx`（`app.js:33`）为死代码（无调用点），不在本次改动范围。

### D5 UI 提示与文档

- 设置区 hint（`src/index.template.html:70`）增加：`目标 ≤8KB 时大小容差自动放宽至 ±12%；PNG 小目标为无损尽力而为（内容受限时输出最大可达）。`
- README.md：
  - 使用方法第 3 条：`目标大小（默认 100 KB，支持 1 KB – 2 MB）`（顺带修正 README 与代码默认值 50/100KB 不符的旧文案）。
  - 输出规则：补充"小目标（≤8KB）容差自动放宽至 ±12%；JPEG 质量下限随目标缩小（1KB≈q30）；PNG 在 1KB 级为无损尽力而为"。
  - 常见问题：补充"1KB 级 PNG 输出可能大于目标（内容受限），属正常"。

### D6 新增「下载全部」按钮（直接逐张下载）

- 新按钮 `#btnDownloadAll`，位于操作栏「下载 ZIP」旁，文案「下载全部」。
- 行为：遍历所有 `status === 'done'` 项逐个触发 `downloadBlob()`（复用现有单张下载函数）；文件名平铺去重（复用 `exportZip` 的 `used` Set + `_k` 后缀逻辑，抽出共享小函数）；相邻下载间隔 ~120ms（防 Chrome 丢弃快速连续的程序化下载）；跳过失败/未完成项。
- 禁用条件与「下载 ZIP」一致：`!hasDone || state.converting`（`updateButtons()`）。
- 首次使用浏览器会弹一次"允许下载多个文件"确认（Chrome 正常行为），按钮 `title` 属性注明。
- 实现位置：`src/app.js` 新增 `downloadAll()`、`bindActions` 绑定、`updateButtons` 状态；`src/index.template.html` 加按钮。

## 测试与验证

1. `tools/gen-e2e.js` 增加 1KB 轮（复用 `convertRound` 模式）：
   - 硬约束：全部输出 ≤ 1.12 KB（非坏文件）。
   - JPEG 输入（photo-input.jpg）：命中 [0.88, 1.12] KB 窗口或内容受限有效输出。
   - PNG：全部 ≤ 1.12 KB（允许内容受限，即 `jkb > 5` 有效输出即可，阈值按 1KB 轮缩放）。
   - 现有轮次（50KB 等）断言不变——验证 ≥21KB 行为无回归。
2. 「下载全部」e2e：转换完成后点击 `#btnDownloadAll`，runner 侧（`tools/e2e-run.js`，已有 `Page.setDownloadBehavior` + dlDir 骨架）等待 dlDir 中出现 N 个非 zip 图片文件，校验每张 ≤ 本轮上限（1.12KB）；全部文件名与去重规则符合预期。
3. 全量回归：`node build.js` → `node tests/logic.test.js`（node --test）→ `node tools/gen-e2e.js && node tools/e2e-run.js`。
4. 手工浏览器验证：1KB 目标下输出图片在 1.5cm 级显示的观感（q30 块效应是否可接受）；「下载全部」首次触发浏览器多文件下载提示的行为。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/index.template.html` | min 1、单位文案、hint 文案、`#btnDownloadAll` 按钮 |
| `src/app.js` | D1 clamp ×2、D2 minQ 曲线、D3 effTol、D4 像素下限 ×3、D6 `downloadAll()` + 去重共享函数 + 绑定 |
| `README.md` | D5 文案、D6 使用方法（「下载全部」逐张下载） |
| `tools/gen-e2e.js` | 1KB 轮 + 下载全部轮 |
| `tools/e2e-run.js` | 非 zip 下载文件等待/校验（复用现有 dlDir 骨架） |
| `docs/superpowers/specs/2026-08-12-min-1kb-compression-design.md` | 本文档 |

不需要改动：`src/logic.js`（编码器已有能力）、`build.js`、`src/style.css`。
