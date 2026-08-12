# 小一寸模式设计（固定 64×89 像素）

日期：2026-08-12
状态：已批准

## 需求（用户确认）

新增"小一寸模式"勾选：
1. **固定像素 64×89**（比例 64:89 ≈ 小一寸 2.2:3.2）；
2. 勾选时**自动设物理尺寸 2.2×3.2cm**，取消勾选**恢复用户原设置**；
3. **模式下忽略目标大小**（目标输入置灰，输出自然大小）；
4. **高级设置（饱和度/抖动/色数）依旧可选**（手动档优先，自动档按固定 32 色语境）。

## 设计决策

### D1 设置与 UI

- `state.settings` 新增 `idMode: false`、`idSavedSize: null`（勾选时暂存原物理尺寸）；
- 设置区目标大小字段后新增勾选框 `小一寸模式（固定 64×89 像素 · 2.2×3.2cm）`（id `idModeToggle`）；
- 勾选：暂存 sizeW/sizeH → 设 2.2/3.2 → 目标输入 `disabled`（提示"忽略目标大小"）；
  取消：恢复暂存尺寸 → 目标输入恢复；
- 持久化（localStorage）；`renderSettings` 同步勾选状态与目标禁用。

### D2 转换管线（convertOne 分支 `convertOneFixed`）

- 裁剪比例 `[64, 89]` → `drawCanvas` 直接缩放至 **64×89px**（无目标演算二分）；
- 后处理（固定默认 + 高级设置覆盖）：
  - 去噪：轻 1 遍（固定）；
  - **饱和**：`satMode` 手动档，自动档按色数（8 色 0.25 / 16 色 0.22 / 32 色 0.12）；
  - **色数**：`colorMode` 手动档，自动档固定 **32**；
  - **抖动**：`ditherMode` 手动档，自动档 0.5；
  - 锐化：缩小发生（源 > 64×89）→ `lightSharpen` 照旧；
- 编码：
  - PNG：调色板（色数 >0）/ 全彩（0，含 oxipng 优化）→ pHYs 写入；
  - JPEG：mozjpeg **q85** 高质量直出 → JFIF DPI 写入；
- DPI 元数据：`dpiFromPx(89, 3.2) ≈ 71 DPI`（小一寸物理规格）；
- `outPxW=64, outPxH=89`；note 标注"小一寸 64×89"。

### D3 e2e 与文档

- e2e 轮 7：勾选 → 尺寸联动 2.2×3.2 + 目标置灰断言 → 导入转换 → 预览 meta 含 `64×89px`
  → 取消勾选恢复断言；
- hint/README：小一寸模式说明。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/app.js` | D1：settings/UI 绑定；D2：`convertOneFixed` + 分支 |
| `src/index.template.html` | D1：勾选框；D3：hint |
| `tools/gen-e2e.js` | D3：轮 7 |
| `README.md` | D3 |
| `docs/superpowers/specs/2026-08-12-idphoto-mode-design.md` | 本文档 |

不需要改动：`src/logic.js`、`build.js`、`tools/e2e-run.js`。
