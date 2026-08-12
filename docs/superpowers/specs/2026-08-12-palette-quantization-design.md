# 小目标调色板量化设计（降色彩精度换像素密度）

日期：2026-08-12
状态：已批准
上游：2026-08-12-denoise-pipeline-design.md（去噪+锐化管线）

## 背景与问题

1KB 级目标下，全彩无损 PNG 分辨率受限（照片类实测 ~23px，DPI 仅 ~38）——
RGB 每像素 3 字节且噪声/细节数据 deflate 压缩率低。
用户需求："降低色彩精度，获得更高的像素"——用调色板量化（有损色彩）换取同文件大小下的更高分辨率。

## 现状盘点（实现成本极低的原因）

- `PI.quantize(rgba, maxColors)`（中位切分量化，`src/logic.js:163`）：已实现、已导出、**未被管线使用**；
- `PI.encodePng({ mode: 'palette', indices, palette, phys })`（`src/logic.js:60-120`，PLTE/tRNS chunk）：已实现、**未被管线使用**。

两块拼图现成，本次仅需接入与编排。

## 设计决策

### D1 触发与色数（currentSettings 计算 `paletteColors`）

| 目标大小 | 色数 | 说明 |
|---|---|---|
| ≤2 KB | 8 色 | 1KB 照片目标 ~48px+（8 色索引数据高度平滑可压） |
| ≤4 KB | 16 色 | 中等 |
| ≤8 KB | 32 色 | 量化痕迹最轻 |
| >8 KB | 0（全彩无损） | 现有行为零变化 |

自动开启、无 UI 开关（与容差放宽/去噪同族策略）。目标下限保持 1KB 不变。

### D2 管线（PNG 分支）

**缩放（finalCanvas）→ 去噪（现有）→ 量化 → palette 编码 → 直接输出**

- `pngToTarget` 增加 `colors` 参数（0 = 全彩原路径）；`encode()` 中 `colors > 0` 时：
  `quantize(data.data, colors)` → `encodePng({ mode:'palette', indices, palette, phys })`；
- 二分搜索在量化图像上进行（量化图像大小单调于像素，二分语义不变）；
- `convertOne` PNG 分支：`paletteColors > 0` 时**跳过 oxipng 重编码**（封装仅收 RGBA 全彩
  输入）与**跳过锐化**（锐化引入颜色跳变 → 扰乱索引，收益小且有害）；
- 去噪保留（量化前去噪 → 索引数据更平滑 → deflate 压缩率更高）。

### D3 语义不变

- 调色板 PNG 是标准 PNG（PLTE 索引图），任意查看器正常显示；
- pHYs（DPI/物理尺寸元数据）照常写入，物理尺寸语义不变；
- 硬约束不变：输出 ≤ 目标 × (1 + 有效容差)；二分下限仍为 16px。

### D4 文档

- 设置区 hint（`src/index.template.html:70`）追加：`目标 ≤8KB 时自动启用调色板量化（8–32 色）换取更高分辨率。`
- README 小目标条目补充量化说明。

## 测试与验证

1. 单元测试（`tests/logic.test.js`）：
   - `quantize`：输出颜色数 ≤ maxColors（含透明图 maxColors-1）；调色板大小正确；
   - `encodePng` palette 模式：`parsePng` 解析 IHDR `colorType === 3`、PLTE/tRNS chunk 存在、CRC 合法；
   - 同像素下 palette 编码大小 < 全彩编码大小（量化压缩收益）。
2. e2e：
   - 1KB 轮**强断言**：photo-input 输出 IHDR `colorType === 3`（驱动读 blob 前 8+25 字节）；
   - 分辨率诊断行：照片类 PNG 像素应显著高于全彩路径（预期 40px+）；
   - >8KB 轮（50/30/256KB）断言不变——全彩路径零回归。
3. 全量回归：`node --test tests/logic.test.js` + 构建 + e2e。
4. 手工验证 1KB 目标下 8 色观感（小屏渐变带是否可接受）。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/app.js` | D1：`currentSettings` 加 `paletteColors`；D2：`pngToTarget` 加 `colors` 参数 + `convertOne` 分支（跳过 oxipng/锐化） |
| `tests/logic.test.js` | quantize/palette 编码单测 |
| `tools/gen-e2e.js` | 1KB 轮 colorType 强断言 + 诊断行像素观察 |
| `src/index.template.html` | D4：hint 文案 |
| `README.md` | D4：小目标条目 |
| `docs/superpowers/specs/2026-08-12-palette-quantization-design.md` | 本文档 |

不需要改动：`src/logic.js`（quantize/encodePng 已支持）、`build.js`、`src/style.css`、`tools/e2e-run.js`。
