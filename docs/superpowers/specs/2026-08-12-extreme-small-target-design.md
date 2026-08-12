# 0.1KB 目标下限 + 极端区间（≤0.8KB）8 色调色板设计

日期：2026-08-12
状态：已批准
上游：2026-08-12-palette-quantization-design.md、2026-08-12-saturation-boost-design.md

## 需求

1. 目标大小下限从 1KB 扩展到 **0.1KB**（≈102B）；
2. **8 色调色板（极端低色数）只用于 ≤0.8KB**，0.8–8KB 用 16/32 色；
3. JPEG 在 0.1KB 目标下物理不可达（最小文件 ~200B，表开销不可压缩）→ **输出最小可达 + 提示**（用户已确认）。

## 物理极限核算（0.1KB = 102B，有效上限 102×1.12 = 114B）

- PNG 固定开销：sig 8 + IHDR 25 + IEND 12 + IDAT 头 12 + PLTE 头 12 = 69B + 3B/色；
  - 8 色：固定 93B + deflate 最低 ~29B（zlib 头尾 11B + 块头）→ 照片类最小 ~122B > 114B **不可达**；
  - 4 色：固定 81B → **3×3px（raw 12B）≈ 113B ✓ 命中窗口**；2×2 ≈ 110B；
  - 纯色/极简内容（palette 1–2 色）：固定 ≤84B → 5×5px 级可达；
- JPEG：最小 ~200B 起（DQT/DHT/SOF/SOS 表开销不可压缩）→ 0.1KB 目标永远超窗。

**结论：0.1KB 目标照片类需要 4 色调色板 + 3×3px 下限**（0.2–0.8KB 区间 8 色可达：0.2KB 上限 229B，8 色 4×4 ≈ 135B ✓）。

## 设计决策

### D1 目标下限 1 → 0.1KB（UI 与校验）

- `src/index.template.html:37`：`min="1" step="1"` → `min="0.1" step="0.1"`，单位文案 `KB（0.1 – 2048）`；
- `src/app.js`：`bindSettings` 与 `updatePxHint` 的 `clampNum(..., 1, ...)` → `clampNum(..., 0.1, ...)`；
- `targetBytes = Math.max(1, Math.round(0.1 × 1024)) = 102`（现有公式已支持小数 targetKB）。

### D2 色数梯度（8 色收窄到 ≤0.8KB；0.1KB 级用 4 色）

| 目标大小 | paletteColors |
|---|---|
| ≤0.2 KB | **4**（0.1KB 可达必需：3×3px ≈ 113B） |
| ≤0.8 KB | **8**（极端低色数，用户指定区间） |
| ≤4 KB | 16 |
| ≤8 KB | 32 |
| >8 KB | 0 全彩 |

### D3 像素下限（0.1KB 可达所需）

- `pngToTarget` 二分下限 16 → **3**（4 色 3×3px 命中 114B 窗口）；
- `jpegToTarget` 下限 16 → **8**（JPEG 最小块 8×8）；
- `updatePxHint` 的 `Math.max(16, …)` 下限保持（起始提示语义，0.1KB 显示 16px 级起始）。

### D4 JPEG 最小可达 + 提示（≤0.5KB 目标）

- `jpegToTarget`：下限 8px、minQ 按动态曲线（0.1KB → q30）——二分找到的最小值仍 > 目标窗口时，
  输出最小可达（不违反"内容受限"语义，但结果超窗）；
- `convertOne` JPEG 分支：编码后 `resultBlob.size > targetBytes × (1 + effTol)` 时
  `item.note = 'JPEG 物理下限（~0.2KB 起），已输出最小可达'`；
- e2e 0.1KB 轮：JPEG 行允许超窗（note 断言观察性）。

### D5 e2e 与文案

- e2e 新增 0.1KB 轮（独立段，不复用 convertRound——JPEG 需豁免超窗）：
  - PNG 全部 ≤ 0.114KB（4 色 3×3 ≈ 113B 命中）；
  - JPEG 允许超窗且 note 含"物理下限"；
  1KB 轮自动变为 16 色档（0.8–4KB）——PALETTE_OK 断言不变；
- hint/README：目标范围更新 + "8 色仅 ≤0.8KB" + "JPEG 物理下限 ~0.2KB" 说明。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/index.template.html` | D1：min/step/文案；D5：hint |
| `src/app.js` | D1：clamp ×2；D2：paletteColors 梯度；D3：像素下限 ×2；D4：note 提示 |
| `tools/gen-e2e.js` | D5：0.1KB 轮 |
| `README.md` | D5 |
| `docs/superpowers/specs/2026-08-12-extreme-small-target-design.md` | 本文档 |

不需要改动：`src/logic.js`（编码器已支持任意尺寸/色数）、`tools/e2e-run.js`。
