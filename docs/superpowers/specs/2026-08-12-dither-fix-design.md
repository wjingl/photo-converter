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

### D1 色数梯度调整

| 目标大小 | 色数（现） | 色数（新） |
|---|---|---|
| ≤4 KB | 8 / 16 | **16** |
| ≤8 KB | 32 | **32**（不变） |
| >8 KB | 0 全彩 | 0（不变） |

1KB 甜点色数 16：48×72 仅 886B ≤ 1.12KB 上限，MSE 降 73%。≤4KB 统一 16 色
（原 ≤2KB 档 8 色并入）。

### D2 Floyd-Steinberg 误差扩散抖动（logic.js 新增 `ditherIndices`）

`PI.ditherIndices(rgba, palette)` → indices：以 `quantize` 产出的调色板为基准，
从左到右、从上到下对每个像素取最近色并把量化误差按 7/16、3/16、5/16、1/16
扩散给右侧/左下/下方/右下邻居。确定性算法（无随机），二分搜索语义保持。

- `quantize` 保持纯净（不抖动），组合由调用方完成：`quantize` → `ditherIndices` → `encodePng`；
- 成本：O(像素×色数)，1KB 目标（≤ 几千像素）可忽略；
- 抖动把可见色带打散成细颗粒（胶片噪点观感），16 色时大小成本仅 +20%。

### D3 管线与验证

- app.js：`paletteColors = targetKB <= 4 ? 16 : targetKB <= 8 ? 32 : 0`；
  `pngToTarget` encode() 调色板分支加 `PI.ditherIndices(data.data, palette)`；
- 单测：`ditherIndices` 输出长度/索引合法；**banding 打破断言**——渐变图抖动后
  相邻索引变化比例显著高于无抖动；
- e2e：PALETTE_OK（colorType=3）断言不变；1KB 轮分辨率诊断行观察像素；
- 文案：hint/README 的"8–32 色"→"16–32 色"，注明误差扩散抖动。

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
