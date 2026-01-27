# 主题系统说明

## 架构概览

主题系统由以下部分组成：

1. **主题配置** (`src/themes/index.ts`) - 主题颜色定义和管理
2. **CSS 变量** (`src/index.css`) - 实际应用到 DOM 的 CSS 变量
3. **主题 Hook** (`src/hooks/useTheme.ts`) - React 主题状态管理

## 当前主题

### Light（浅色主题）
- 纯净的灰白色系
- 高对比度，适合长时间阅读
- 无色调偏移，保持中性

### Dark（深色主题）
- 带轻微暖色调的深色背景
- 减少蓝光，降低眼睛疲劳
- 适合夜间使用

## 如何添加新主题

### 1. 定义主题配置

在 `src/themes/index.ts` 中添加新主题：

```typescript
export const oceanTheme: ThemeColors = {
  background: {
    bg000: '200 30% 95%',  // 海洋蓝基调
    bg100: '200 25% 92%',
    // ... 其他颜色
  },
  // ... 完整配置
}
```

### 2. 注册主题

在 `themes` 对象中注册：

```typescript
export const themes = {
  light: lightTheme,
  dark: darkTheme,
  ocean: oceanTheme,  // 新增
} as const
```

### 3. 添加 CSS 变量

在 `src/index.css` 中添加对应的 CSS 规则：

```css
[data-mode="ocean"] {
  --bg-000: 200 30% 95%;
  --bg-100: 200 25% 92%;
  /* ... 其他变量 */
}
```

### 4. 扩展类型定义

在 `src/hooks/useTheme.ts` 中扩展 `ThemeMode` 类型：

```typescript
export type ThemeMode = 'system' | 'light' | 'dark' | 'ocean'
```

### 5. 更新 UI

在主题选择器中添加新选项（`src/features/chat/Header.tsx`）。

## 颜色命名规范

### 背景色 (bg-*)
- `bg-000`: 最亮/最暗背景（基础容器）
- `bg-100`: 次级背景（面板）
- `bg-200`: 卡片背景
- `bg-300`: 悬停状态
- `bg-400`: 激活状态

### 文本色 (text-*)
- `text-000`: 反色文本（白色 on dark，黑色 on light）
- `text-100`: 主要文本（最高对比度）
- `text-200`: 次要文本
- `text-300`: 辅助文本
- `text-400`: 占位符/提示
- `text-500`: 禁用状态
- `text-600`: 分隔线/边框

### 语义化颜色
- `success-*`: 成功状态（绿色系）
- `warning-*`: 警告状态（黄/橙色系）
- `danger-*`: 危险/错误状态（红色系）
- `info-*`: 信息提示（蓝色系）

## 调色技巧

### HSL 颜色格式
使用 HSL 便于调整：
- **色相 (H)**: 0-360，决定颜色种类
  - 0/360: 红
  - 120: 绿
  - 210-240: 蓝
  - 24: 橙
- **饱和度 (S)**: 0-100%，颜色鲜艳程度
- **亮度 (L)**: 0-100%，明暗程度

### 浅色主题调色原则
- 背景：高亮度（90-100%），低饱和度（0-5%）
- 文本：低亮度（5-60%），低饱和度（0-10%）
- 强调色：中亮度（40-60%），高饱和度（70-95%）

### 深色主题调色原则
- 背景：低亮度（5-20%），低饱和度（0-5%）
- 文本：高亮度（60-95%），低饱和度（0-20%）
- 强调色：中高亮度（50-70%），中高饱和度（60-85%）

## 对比度要求

遵循 WCAG 2.1 标准：
- **正常文本**: 至少 4.5:1 对比度
- **大号文本**: 至少 3:1 对比度
- **UI 组件**: 至少 3:1 对比度

使用工具检查：https://contrast-ratio.com/

## 维护建议

1. **保持一致性**: 新主题应保持相同的语义化命名
2. **测试全面性**: 在所有组件中测试新主题
3. **文档更新**: 添加新主题时更新此文档
4. **版本控制**: 主题变更记录在 git commit 中

## 常见问题

### Q: 为什么使用 HSL 而不是 HEX？
A: HSL 更容易调整和维护，可以系统化地生成色阶。

### Q: 如何快速切换主题测试？
A: 使用浏览器 DevTools，手动修改 `<html data-mode="xxx">`。

### Q: 主题不生效怎么办？
A: 检查：
1. CSS 变量是否正确定义
2. `data-mode` 属性是否正确设置
3. 浏览器缓存是否清除

## 参考资源

- [HSL Color Picker](https://hslpicker.com/)
- [Coolors - 配色生成器](https://coolors.co/)
- [Adobe Color](https://color.adobe.com/)
- [Material Design Color System](https://m3.material.io/styles/color/system/overview)
