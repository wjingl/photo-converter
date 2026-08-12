# 小目标饱和增强设计（解决输出发灰）

日期：2026-08-12
状态：已批准
上游：2026-08-12-dither-fix-design.md（调色板量化修复）

## 问题

用户反馈：小目标输出"灰灰的，像死人一样"（鲜明度低）。
实验定位（96×64 模拟照片，平均饱和度 0.553）：
- 去噪 -0.8%、量化 -1.2%——单环节损失小；
- 真实照片主体饱和度低（0.2–0.4），量化格心"饱和像素被不饱和像素平均"→ 整体发闷；
- 实验验证：**压缩前预饱和增强可完全补偿**——+15% 预增强后输出比源还鲜亮 4.2%。

## 设计决策

### D1 `boostSaturation`（logic.js 新增）

`PI.boostSaturation(rgba, w, h, amount)`：RGB 近似向亮度拉伸——
`l = (r+g+b)/3`，`c' = clamp(l + (c-l) × (1+amount))`。灰度像素（r=g=b）不变，
纯黑/纯白不变；彩色像素饱和度提升。确定性，原地修改，node 可测。

### D2 强度随目标缩放（currentSettings 计算 `satBoost`）

| 目标大小 | satBoost |
|---|---|
| ≤2 KB | 0.25（强补偿） |
| 2–8 KB | 0.12（温和） |
| >8 KB | 0（不做，现有行为） |

与 denoisePasses/paletteColors 同族策略（小目标自动）。

### D3 管线位置（convertOne 两路径统一）

**缩放（finalCanvas）→ 去噪（现有）→ 饱和增强（新增）→ 量化/编码**

- PNG 路径：去噪后、量化（paletteColors>0）前应用（补偿量化格心平均化）；
- JPEG 路径：去噪后、锐化前应用（补偿 q30 + 4:2:0 色度下采样的饱和损失）；
- 熵增代价：饱和增强让索引/色度熵略增 → 像素略降（e2e 诊断行观察）。

### D4 测试与文案

- 单测：`boostSaturation` 灰度/黑白像素不变、彩色像素饱和度（max-min）提升、值域合法；
- e2e：现有断言不变（PALETTE_OK 等），1KB 轮诊断行观察像素；
- 文案：hint/README 小目标条目补"自动饱和增强"。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/logic.js` | D1：`boostSaturation` 导出 |
| `src/app.js` | D2：`satBoost`；D3：两路径插入 |
| `tests/logic.test.js` | boostSaturation 单测 |
| `src/index.template.html` / `README.md` | D4：文案 |
| `docs/superpowers/specs/2026-08-12-saturation-boost-design.md` | 本文档 |

不需要改动：`tools/*`、`build.js`。
