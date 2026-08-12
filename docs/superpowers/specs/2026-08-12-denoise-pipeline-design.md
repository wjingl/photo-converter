# 小目标去噪 + 压缩后锐化管线设计

日期：2026-08-12
状态：已批准
上游：2026-08-12-min-1kb-compression-design.md（1KB 压缩目标）

## 背景与问题

1KB 压缩目标已实现（目标下限 1KB、动态质量下限、±12% 小目标容差、像素下限 16px）。
用户反馈：1KB 级 **PNG 无损** 输出分辨率受限（照片类实测 ~20px）——无损 PNG 对照片
噪声内容的 deflate 压缩率仅 ~1.0–1.2×，1KB 容量只够 ~16–24px 全彩。

**去噪**（低通滤波）让像素更平滑 → 压缩率提升 → 同大小可承载更高分辨率。
**压缩后锐化**恢复缩放/压缩造成的边缘软化。

## 收益边界（设计约束，防止预期落空）

- 大幅缩小场景（1200px → 20px，缩 60 倍）：重采样本身已是强力低通，去噪边际收益低；
- 中等缩小（100px → 20px，缩 4–6 倍）：去噪收益高（重采样平均不足以消除残留噪声）；
- JPEG 路径：预去噪减少量化块效应，且 `encodeJpegMozBest` 会因文件变小自动升 q 追窗口
  → 同大小质量自动提升；
- PNG 二分搜索基于未去噪编码（与现有 oxipng 偏差同类）：结果略保守但绝不超上限。

## 设计决策

### D1 `boxBlur` 抽取（logic.js）

把 `unsharpMask` 内部的两遍盒式模糊内核（半径 1，横/纵两遍，`logic.js:211-233`）
抽为独立导出函数，`unsharpMask` 内部复用，零重复：

```
PI.boxBlur(rgba, w, h, radius, passes) -> rgba
```

要求：尺寸/通道不变；alpha 通道不动；纯 JS，node 可测。

### D2 去噪强度随目标缩放（currentSettings 计算 `denoisePasses`）

| 目标大小 | 去噪遍数（半径 1） |
|---|---|
| ≤1 KB | 2 遍（强） |
| 2–8 KB | 1 遍（轻） |
| >8 KB | 0 遍（不去噪，细节完整保留） |

自动开启、无 UI 开关（与 effTol/动态质量下限同类引擎策略）。

### D3 管线顺序（app.js convertOne 两路径统一）

**缩放（finalCanvas）→ 去噪 → 锐化 → 编码**

- PNG 路径：新增此前缺失的压缩后锐化——去噪后 `lightSharpen`（复用现有函数，
  强度按缩小比例 0.4–0.5，与 JPEG 路径一致），再进 oxipng/encodePng；
- JPEG 路径：在现有 `lightSharpen` 之前插入去噪（现有 if/else 锐化逻辑不变）；
- 去噪实现：`finalCanvas` getImageData → `PI.boxBlur(data, w, h, 1, denoisePasses)` → putImageData。

### D4 文案

- 设置区 hint（`src/index.template.html:70`）追加：`目标 ≤8KB 时自动轻度去噪提升压缩率，输出附锐化。`
- README 输出规则节补一句（小目标条目内）。

## 测试与验证

1. `tests/logic.test.js` 新增 `boxBlur` 单测：
   - 尺寸/通道数不变（RGBA 长度保持 w×h×4）；
   - 均匀区域输出不变（或等价）；
   - 噪声区域（方差下降：blur 后相邻像素差减小）；
   - `unsharpMask` 现有行为不回归（现有测试通过）。
2. e2e 全量回归（4 轮断言不变，全绿）。
3. e2e 1KB 轮新增**分辨率诊断行**（各 PNG 输出 `px @ DPI`，观察性：验证去噪后
   分辨率不降反升，不做硬断言）。
4. 手工浏览器验证 1KB 目标输出观感。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/logic.js` | D1：抽 `boxBlur` 导出，`unsharpMask` 复用 |
| `src/app.js` | D2：`currentSettings` 加 `denoisePasses`；D3：PNG/JPEG 路径管线插入 + PNG 补锐化 |
| `src/index.template.html` | D4：hint 文案 |
| `README.md` | D4：输出规则一句 |
| `tests/logic.test.js` | boxBlur 单测 |
| `tools/gen-e2e.js` | 1KB 轮分辨率诊断行 |
| `docs/superpowers/specs/2026-08-12-denoise-pipeline-design.md` | 本文档 |

不需要改动：`build.js`、`src/style.css`、`tools/e2e-run.js`。
