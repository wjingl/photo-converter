# 调色板量化修复设计（16 色 + 误差扩散抖动）

日期：2026-08-12
状态：已批准
上游：2026-08-12-palette-quantization-design.md（小目标调色板量化）

## 问题

用户反馈：目标 ≤2KB（8 色）输出"色块崩溃，花花的"。实验数据（48×72 模拟照片，去噪后）：

| 色数 | 无抖动大小 | 量化误差 MSE |
|---|---|---|
| 8（现） | 572 B | 68（高） |
| 16 | 886 B | 18（-73%） |
| 32 | 1481 B | 7 |

根因：① 8 色对照片内容太少，中位切分把大量区域强并 → 色块崩溃；② 无抖动，
量化直接把像素拉向最近色 → 渐变区可见色带台阶（banding）。

## 设计决策

### D1 色数梯度（保持 8/16/32，全部档位启用抖动）

| 目标大小 | 色数 | 说明 |
|---|---|---|
| ≤2 KB | 8 | 极端小目标：8 色 + 抖动（用户确认：抖动解决色带后 8 色可接受） |
| ≤4 KB | 16 | 甜点色数（MSE 降 73%） |
| ≤8 KB | 32 | 不变 |
| >8 KB | 0 全彩 | 不变 |

### D2 Bayer 每通道独立有序抖动（logic.js 新增 `ditherIndices`）

`PI.ditherIndices(rgba, palette, w, h)` → indices：8×8 Bayer 阈值矩阵（R 原矩阵、
G 行平移、B 列镜像），量化前给 **RGB 每通道独立**加 `(bayer/64 - 0.5) × 255/色数`
的确定性扰动。实测：单通道对角线扰动在颜色轨迹上的有效分量仅 ~44%（色带只平移
不交织）；每通道独立扰动构成三维扰动 → 相邻像素阈值不同 → 整片同色区域打散成
棋盘状交织（色带 → 细颗粒）。确定性算法（无随机），二分搜索语义保持。

- `quantize` 保持纯净（不抖动），组合由调用方完成：`quantize` → `ditherIndices` → `encodePng`；
- 成本：O(像素×色数)，1KB 目标（≤ 几千像素）可忽略；
- 实测（32×32 平滑渐变 + 8 色）：同索引连续段平均长度从 ~2.2px 降到 ~1.5px（色带打散）；
- 与 Floyd-Steinberg 对比：FS 保局部平均色但空间打散弱（实测多样性仅 +13%），
  Bayer 有序抖动直接按空间阈值交织（+27%），更适合"打破色带"目标。

### D3 管线与验证

- app.js：`paletteColors = targetKB <= 2 ? 8 : targetKB <= 4 ? 16 : targetKB <= 8 ? 32 : 0`；
  `pngToTarget` encode() 调色板分支加 `PI.ditherIndices(data.data, palette, data.width, data.height)`；
- 单测：`ditherIndices` 输出长度/索引合法；**banding 打破断言**——渐变图抖动后
  同索引连续段长度显著变短（色带→颗粒）；
- e2e：PALETTE_OK（colorType=3）断言不变；1KB 轮分辨率诊断行观察像素；
- 文案：hint/README 注明"8–32 色 + 抖动"。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/logic.js` | D2：新增 `ditherIndices` 导出 |
| `src/app.js` | D3：`paletteColors` 梯度 + encode() 抖动组合 |
| `tests/logic.test.js` | `ditherIndices` 单测 |
| `src/index.template.html` | 文案 |
| `README.md` | 文案 |
| `docs/superpowers/specs/2026-08-12-dither-fix-design.md` | 本文档 |

不需要改动：`tools/gen-e2e.js`、`tools/e2e-run.js`、`build.js`。
