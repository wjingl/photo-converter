# 高级设置设计（饱和度 / 抖动 / 色数用户可配置）

日期：2026-08-12
状态：已批准
上游：2026-08-12-extreme-small-target-design.md（色数梯度）、saturation-boost、dither-fix

## 需求

用户希望把三个画质增强参数从前端暴露为可配置项，**现有自动策略作为默认值**：
1. **饱和度增强**（satBoost）；
2. **抖动强度**（ditherIndices 的 strength 系数）；
3. **调色板色数档位**（paletteColors）。

置于**高级设置折叠栏**；粒度：滑杆 + 自动档（勾选自动时滑杆禁用，跟随现有智能策略）。

## 设计决策

### D1 设置项与存储（state.settings，localStorage 持久化）

| 设置键 | 类型 | 默认 | 语义 |
|---|---|---|---|
| `satAuto` | bool | true | 自动 = 随色数自适应（8 色 0.25 / 16 色 0.22 / 32 色 0.12 / 全彩 0） |
| `satPct` | number | 22 | 手动饱和度百分比（0–50，取消自动时生效） |
| `ditherAuto` | bool | true | 自动 = `255/色数 × 0.5` |
| `ditherPct` | number | 50 | 手动抖动强度系数百分比（0–100，0 = 关闭抖动） |
| `colorMode` | string | 'auto' | 'auto' / '8' / '16' / '32' / 'full'（全彩无损） |

旧缓存兼容：loadSettings 的 Object.assign 不覆盖缺失键 → 新键保留默认 ✓。

### D2 currentSettings 覆盖逻辑

```
paletteColors = colorMode === 'auto' ? 自动梯度 : colorMode === 'full' ? 0 : parseInt(colorMode)
satBoost      = satAuto ? 自动公式 : satPct / 100
ditherFactor  = ditherAuto ? 0.5 : ditherPct / 100
```

- `currentSettings()` 新增 `ditherFactor` 字段；
- `pngToTarget` 新增第 9 参 `ditherFactor = 0.5`；encode() 调色板分支：
  `ditherFactor > 0` 时 `PI.ditherIndices(data, palette, w, h, ditherFactor)`，
  否则直接用 quantize 的原始索引（关闭抖动）。

### D3 `ditherIndices` 强度系数参数化（logic.js）

签名 `ditherIndices(rgba, palette, w, h, strengthFactor = 0.5)`：
`strength = 255/色数 × strengthFactor`。默认 0.5 向后兼容（现有单测不改）。

### D4 UI（src/index.template.html 设置区新增折叠栏）

```
<details id="advancedPanel">
  <summary>高级设置</summary>
  <label>饱和度增强 [自动✓] 滑杆 0–50%</label>
  <label>抖动强度   [自动✓] 滑杆 0–100%（0 = 关闭）</label>
  <label>调色板色数 [下拉] 自动 / 8 色 / 16 色 / 32 色 / 全彩无损</label>
</details>
```

- 控件 id：`satAutoToggle`、`satSlider`、`ditherAutoToggle`、`ditherSlider`、`colorModeSelect`；
- renderSettings/bindSettings 扩展；自动勾选时滑杆 disabled；
- 勾选自动的变更即时 saveSettings（现有机制）。

### D5 测试钩子与 e2e

- `app.js` boot 后挂 `window.__piState = () => ({ settings: state.settings })`（轻量调试钩子）；
- e2e 断言：
  - 高级栏存在且折叠默认收起；
  - 覆盖生效：设 `colorMode='8'` → `__piState().settings.colorMode === '8'` + 转换 50KB 轮
    PNG 输出为调色板（复用下载校验？——改为断言 `__piState` 与转换完成即可，colorType 已有 1KB 轮覆盖）；
  - 自动档恢复后滑杆重新禁用。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/logic.js` | D3：`ditherIndices` 加 `strengthFactor` 参数 |
| `src/app.js` | D1：settings 默认；D2：currentSettings + pngToTarget；D4：UI 绑定；D5：钩子 |
| `src/index.template.html` | D4：高级栏 |
| `tools/gen-e2e.js` | D5：断言 |
| `README.md` | 高级设置说明 |
| `docs/superpowers/specs/2026-08-12-advanced-settings-design.md` | 本文档 |

不需要改动：`tools/e2e-run.js`、`build.js`。
