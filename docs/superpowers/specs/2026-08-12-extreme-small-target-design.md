# 0.1KB 目标下限 + 极端区间（≤0.8KB）8 色调色板设计

日期：2026-08-12
状态：已批准
上游：2026-08-12-palette-quantization-design.md、2026-08-12-saturation-boost-design.md

## 需求（最终定案，2026-08-12 用户澄清）

1. 目标大小下限从 1KB 扩展到 **0.3KB**（≈307B）；
2. 色数梯度（用户最终确认，勿再变更）：
   - **<0.8KB → 8 色**（极端低色数区间，保留）；
   - **0.8–25KB → 16 色**（把 5-7KB 的好观感扩展到 1–25KB 区间）；
   - **25–50KB → 32 色**；
   - **>50KB → 全彩无损**（现有行为不变）；
3. **饱和增强随色数自适应**：8 色 0.25、16 色 0.18、32 色 0.12、全彩 0；
   抖动由 `ditherIndices` 内建 `255/色数 × 0.5` 自适应；
4. JPEG 低于约 0.2KB 物理不可达（最小 ~200B）→ 输出最小可达 + 标注"物理下限"（用户已确认）。

## 物理极限核算（0.3KB = 307B，有效上限 307×1.12 = 344B）

- PNG 固定开销：sig 8 + IHDR 25 + IEND 12 + IDAT 头 12 + PLTE 头 12 = 69B + 3B/色；
  - 8 色（<0.8KB）：固定 93B → 像素预算 ~250B → **~12×12px**（照片类）✓；
  - 16 色（0.8–25KB）：固定 117B → 0.3KB 下 ~10×10px 可行；25KB 下 ~120px 级；
  - 纯色/极简内容：deflate 高压缩 → 更大像素；
- JPEG：8×8 q25–30 ≈ 200–350B——0.3KB 目标可能命中（实测 0.11/0.33KB 命中窗口），超窗时标注物理下限。

## 设计决策

### D1 目标下限 1 → 0.3KB（UI 与校验）

- `src/index.template.html:37`：`min="1" step="1"` → `min="0.3" step="0.1"`，单位文案 `KB（0.3 – 2048）`；
- `src/app.js`：`bindSettings` 与 `updatePxHint` 的 `clampNum(..., 1, ...)` → `clampNum(..., 0.3, ...)`；
- `targetBytes = Math.max(1, Math.round(0.3 × 1024)) = 307`（现有公式已支持小数 targetKB）。

### D2 色数梯度（最终定案）

| 目标大小 | paletteColors |
|---|---|
| <0.8 KB | **8**（极端低色数区间，保留） |
| 0.8–25 KB | **16**（核心诉求：5-7KB 好观感扩展至此区间） |
| 25–50 KB | **32** |
| >50 KB | 0 全彩（现有行为不变） |

### D2b 饱和增强随色数自适应

```
satBoost = paletteColors === 8 ? 0.25 : paletteColors === 16 ? 0.22 : paletteColors === 32 ? 0.12 : 0
```

- 色数越少补偿越强（8 色 0.25 / 16 色 0.22 / 32 色 0.12 / 全彩 0；16 色 0.22 为用户 2026-08-12 调高）；
- 抖动无需改：`ditherIndices` 的 `255/色数 × 0.5` 已按色数自动缩放。

### D3 像素下限与性能

- `pngToTarget` 二分下限 16 → **8**（8 色 8×8 ≈ 200B ≤ 344B ✓）；
- `jpegToTarget` 下限 16 → **8**（JPEG 最小块 8×8）；
- **性能修复**：调色板路径与 JPEG 路径在 targetBytes ≤ 512 时收紧像素上界
  （`min(upper, ceil(sqrt(targetBytes×8))+2)`，deflate ≥8x 保守假设）——否则二分从超大
  mid 开始，每轮大尺寸 quantize/deflate 开销撑爆批处理（0.3KB 上界 ≈ 52px，二分 6 轮）；
- `updatePxHint` 的 `Math.max(16, …)` 下限保持（起始提示语义）。

### D4 JPEG 最小可达 + 提示（≤0.5KB 目标）

- `jpegToTarget`：下限 8px、minQ 按动态曲线（0.3KB → q30）——二分找到的最小值仍 > 目标窗口时，
  输出最小可达（不违反"内容受限"语义，但结果超窗）；
- `convertOne` JPEG 分支：编码后 `resultBlob.size > targetBytes × (1 + effTol)` 时
  `item.note = 'JPEG 物理下限（~0.2KB 起），已输出最小可达'`；
- e2e 0.3KB 轮：JPEG 行允许超窗（note 断言观察性）。

### D5 e2e 与文案

- e2e 轮次（最终）：50/30/256KB（>50KB 全彩）+ 10KB（0.8–25KB 16 色）+ 1KB（16 色，PALETTE_OK）
  + 0.3KB（<0.8KB 8 色独立轮：PNG ≤ 0.336KB、JPEG 命中或物理下限标注）；
- hint/README：目标范围 0.3–2048KB + 色数梯度说明 + JPEG 物理下限。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/index.template.html` | D1：min/step/文案；D5：hint |
| `src/app.js` | D1：clamp ×2；D2：paletteColors 梯度；D3：像素下限 ×2；D4：note 提示 |
| `tools/gen-e2e.js` | D5：0.1KB 轮 |
| `README.md` | D5 |
| `docs/superpowers/specs/2026-08-12-extreme-small-target-design.md` | 本文档 |

不需要改动：`src/logic.js`（编码器已支持任意尺寸/色数）、`tools/e2e-run.js`。
