/**
 * 主题系统
 *
 * 架构说明：
 * - 每个"主题风格"（ThemePreset）包含 light 和 dark 两套配色
 * - 用户选择 主题风格 + 日夜模式（system/light/dark）
 * - 自定义主题通过用户提供的 CSS 覆盖 CSS 变量实现
 *
 * 颜色格式：HSL 不带 hsl() 包装，如 '210 90% 50%'
 */

// ============================================
// Types
// ============================================

export interface ThemeColors {
  /** 背景色 */
  background: {
    bg000: string
    bg100: string
    bg200: string
    bg300: string
    bg400: string
  }
  /** 文本色 */
  text: {
    text000: string
    text100: string
    text200: string
    text300: string
    text400: string
    text500: string
    text600: string
  }
  /** 品牌色 */
  accent: {
    brand: string
    main000: string
    main100: string
    main200: string
    secondary100: string
  }
  /** 语义化颜色 */
  semantic: {
    success100: string
    success200: string
    successBg: string
    warning100: string
    warning200: string
    warningBg: string
    danger000: string
    danger100: string
    danger200: string
    dangerBg: string
    danger900: string
    info100: string
    info200: string
    infoBg: string
  }
  /** 边框色 */
  border: {
    border100: string
    border200: string
    border300: string
  }
  /** 特殊色 */
  special?: {
    alwaysBlack?: string
    alwaysWhite?: string
    oncolor100?: string
  }
}

export interface ThemePreset {
  id: string
  name: string
  description: string
  light: ThemeColors
  dark: ThemeColors
}

// ============================================
// Eucalyptus 主题 - 莫兰迪色系，默认主题
// ============================================
// 设计理念：
// - 灵感来自北欧森林与晨雾，莫兰迪色系高级灰调
// - 日间：极淡灰调底色搭配低饱和桉树绿，清爽冷静
// - 夜间：深邃的岩石蓝灰（非纯黑），对比度柔和护眼
// - 品牌色为桉树绿 (hsl 165)，辅助色板岩蓝 (hsl 200)

const eucalyptusLight: ThemeColors = {
  background: {
    bg000: '150 10% 99%',
    bg100: '150 12% 96%',
    bg200: '150 12% 93%',
    bg300: '150 10% 89%',
    bg400: '150 10% 85%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '170 15% 15%',
    text200: '170 10% 40%',
    text300: '170 8% 55%',
    text400: '170 8% 70%',
    text500: '170 6% 78%',
    text600: '170 10% 85%',
  },
  accent: {
    brand: '165 45% 42%',
    main000: '165 40% 35%',
    main100: '165 45% 42%',
    main200: '165 50% 48%',
    secondary100: '200 45% 50%',
  },
  semantic: {
    success100: '140 40% 40%',
    success200: '140 35% 32%',
    successBg: '140 30% 94%',
    warning100: '35 80% 45%',
    warning200: '35 70% 38%',
    warningBg: '35 60% 94%',
    danger000: '5 55% 40%',
    danger100: '5 60% 55%',
    danger200: '5 65% 62%',
    dangerBg: '5 60% 96%',
    danger900: '5 50% 93%',
    info100: '200 50% 50%',
    info200: '200 45% 60%',
    infoBg: '200 40% 95%',
  },
  border: {
    border100: '160 10% 86%',
    border200: '160 10% 82%',
    border300: '160 10% 75%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

const eucalyptusDark: ThemeColors = {
  background: {
    bg000: '210 20% 18%',
    bg100: '210 20% 14%',
    bg200: '210 20% 11%',
    bg300: '210 20% 9%',
    bg400: '210 25% 6%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '210 15% 92%',
    text200: '210 10% 70%',
    text300: '210 8% 55%',
    text400: '210 8% 40%',
    text500: '210 6% 32%',
    text600: '210 10% 25%',
  },
  accent: {
    brand: '165 50% 55%',
    main000: '165 45% 45%',
    main100: '165 50% 55%',
    main200: '165 55% 65%',
    secondary100: '200 50% 60%',
  },
  semantic: {
    success100: '140 50% 55%',
    success200: '140 45% 62%',
    successBg: '140 30% 15%',
    warning100: '35 80% 60%',
    warning200: '35 75% 68%',
    warningBg: '35 30% 15%',
    danger000: '5 65% 60%',
    danger100: '5 70% 65%',
    danger200: '5 72% 72%',
    dangerBg: '5 30% 15%',
    danger900: '5 28% 22%',
    info100: '200 60% 65%',
    info200: '200 55% 72%',
    infoBg: '200 30% 15%',
  },
  border: {
    border100: '210 15% 22%',
    border200: '210 15% 26%',
    border300: '210 15% 32%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

export const eucalyptusTheme: ThemePreset = {
  id: 'eucalyptus',
  name: 'Eucalyptus',
  description: 'Morandi tones, fresh and eye-friendly',
  light: eucalyptusLight,
  dark: eucalyptusDark,
}

// 默认主题 ID
export const DEFAULT_THEME_ID = 'eucalyptus'

// ============================================
// Claude 主题 - 暖调橙色品牌风格
// ============================================

const claudeLight: ThemeColors = {
  background: {
    bg000: '45 40% 99%',
    bg100: '45 35% 96%',
    bg200: '45 30% 93%',
    bg300: '45 25% 90%',
    bg400: '45 20% 86%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '30 10% 15%',
    text200: '30 8% 35%',
    text300: '30 6% 50%',
    text400: '30 5% 60%',
    text500: '30 4% 70%',
    text600: '30 3% 82%',
  },
  accent: {
    brand: '24 90% 50%',
    main000: '24 85% 45%',
    main100: '24 90% 50%',
    main200: '24 95% 55%',
    secondary100: '210 85% 50%',
  },
  semantic: {
    success100: '142 70% 40%',
    success200: '142 65% 32%',
    successBg: '142 60% 94%',
    warning100: '38 92% 48%',
    warning200: '32 88% 42%',
    warningBg: '48 90% 92%',
    danger000: '0 65% 38%',
    danger100: '0 72% 48%',
    danger200: '0 78% 58%',
    dangerBg: '0 75% 95%',
    danger900: '0 55% 92%',
    info100: '210 85% 48%',
    info200: '210 80% 58%',
    infoBg: '210 90% 95%',
  },
  border: {
    border100: '35 15% 82%',
    border200: '35 12% 85%',
    border300: '35 18% 78%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

const claudeDark: ThemeColors = {
  background: {
    bg000: '30 3% 20%',
    bg100: '30 3% 15%',
    bg200: '30 3% 12%',
    bg300: '30 3% 9%',
    bg400: '0 0% 5%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '40 20% 95%',
    text200: '40 10% 75%',
    text300: '40 5% 60%',
    text400: '40 3% 50%',
    text500: '40 2% 40%',
    text600: '40 2% 30%',
  },
  accent: {
    brand: '24 70% 55%',
    main000: '24 75% 50%',
    main100: '24 80% 58%',
    main200: '24 85% 62%',
    secondary100: '210 80% 60%',
  },
  semantic: {
    success100: '142 70% 50%',
    success200: '142 65% 60%',
    successBg: '142 50% 15%',
    warning100: '38 90% 55%',
    warning200: '38 85% 65%',
    warningBg: '38 50% 15%',
    danger000: '0 85% 65%',
    danger100: '0 70% 55%',
    danger200: '0 75% 65%',
    dangerBg: '0 50% 15%',
    danger900: '0 50% 25%',
    info100: '210 85% 60%',
    info200: '210 80% 70%',
    infoBg: '210 50% 15%',
  },
  border: {
    border100: '40 5% 25%',
    border200: '40 5% 30%',
    border300: '40 5% 35%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

export const claudeTheme: ThemePreset = {
  id: 'claude',
  name: 'Claude',
  description: 'Warm orange tones, the classic look',
  light: claudeLight,
  dark: claudeDark,
}

// ============================================
// Breeze 主题 - 现代化清新护眼
// ============================================
// 设计理念：
// - 冷色调蓝绿为品牌色，视觉清爽
// - 日间模式：浅灰蓝底色，低饱和度，减少视觉疲劳
// - 夜间模式：深蓝灰底色，不纯黑，对比度舒适
// - 所有背景饱和度极低（2-8%），阅读不累

const breezeLight: ThemeColors = {
  background: {
    bg000: '210 20% 99%', // 极淡蓝白
    bg100: '210 15% 96.5%', // 浅灰蓝
    bg200: '210 12% 93.5%', // 淡灰蓝
    bg300: '210 10% 90%', // 中灰蓝
    bg400: '210 8% 86%', // 深灰蓝
  },
  text: {
    text000: '0 0% 100%', // 纯白（on-dark surface）
    text100: '215 15% 14%', // 主文本 - 深蓝灰
    text200: '215 10% 34%', // 次要文本
    text300: '215 7% 48%', // 辅助文本
    text400: '215 5% 58%', // 占位符
    text500: '215 4% 68%', // 禁用
    text600: '215 3% 80%', // 分隔线
  },
  accent: {
    brand: '187 72% 42%', // 青绿色品牌色 - 清新感
    main000: '187 68% 36%', // 深青绿
    main100: '187 72% 42%', // 主青绿
    main200: '187 75% 48%', // 浅青绿
    secondary100: '230 65% 55%', // 靛蓝辅助色
  },
  semantic: {
    success100: '152 60% 38%',
    success200: '152 55% 30%',
    successBg: '152 50% 94%',
    warning100: '42 85% 46%',
    warning200: '36 80% 40%',
    warningBg: '48 80% 93%',
    danger000: '4 60% 36%',
    danger100: '4 65% 46%',
    danger200: '4 70% 56%',
    dangerBg: '4 65% 95%',
    danger900: '4 50% 92%',
    info100: '215 75% 48%',
    info200: '215 70% 58%',
    infoBg: '215 80% 95%',
  },
  border: {
    border100: '210 10% 83%',
    border200: '210 8% 86%',
    border300: '210 12% 78%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

const breezeDark: ThemeColors = {
  background: {
    bg000: '215 8% 20%', // 深蓝灰（最亮表面）
    bg100: '215 8% 14%', // 主背景
    bg200: '215 8% 11%', // 下沉面板
    bg300: '215 8% 8%', // 更深
    bg400: '215 10% 5%', // 最深
  },
  text: {
    text000: '0 0% 100%',
    text100: '210 15% 93%', // 主文本 - 淡蓝白
    text200: '210 8% 72%', // 次要文本
    text300: '210 5% 58%', // 辅助文本
    text400: '210 3% 48%', // 占位符
    text500: '210 2% 38%', // 禁用
    text600: '210 2% 28%', // 分隔线
  },
  accent: {
    brand: '187 65% 52%',
    main000: '187 60% 46%',
    main100: '187 65% 52%',
    main200: '187 68% 58%',
    secondary100: '230 60% 62%',
  },
  semantic: {
    success100: '152 55% 48%',
    success200: '152 50% 58%',
    successBg: '152 40% 14%',
    warning100: '42 82% 52%',
    warning200: '42 78% 62%',
    warningBg: '42 45% 14%',
    danger000: '4 75% 62%',
    danger100: '4 65% 52%',
    danger200: '4 68% 62%',
    dangerBg: '4 45% 14%',
    danger900: '4 42% 24%',
    info100: '215 75% 58%',
    info200: '215 70% 68%',
    infoBg: '215 45% 14%',
  },
  border: {
    border100: '215 6% 24%',
    border200: '215 5% 28%',
    border300: '215 7% 32%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

export const breezeTheme: ThemePreset = {
  id: 'breeze',
  name: 'Breeze',
  description: 'Cool teal tones, easy on the eyes',
  light: breezeLight,
  dark: breezeDark,
}

// ============================================
// Sakura 主题 - 粉白色系
// ============================================

const sakuraLight: ThemeColors = {
  background: {
    bg000: '350 30% 99%',
    bg100: '350 25% 97%',
    bg200: '350 20% 94%',
    bg300: '350 18% 90%',
    bg400: '350 15% 86%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '340 20% 15%',
    text200: '340 15% 35%',
    text300: '340 10% 50%',
    text400: '340 8% 62%',
    text500: '340 6% 72%',
    text600: '340 5% 82%',
  },
  accent: {
    brand: '340 70% 55%',
    main000: '340 65% 48%',
    main100: '340 70% 55%',
    main200: '340 75% 62%',
    secondary100: '320 60% 50%',
  },
  semantic: {
    success100: '140 50% 42%',
    success200: '140 45% 35%',
    successBg: '140 40% 94%',
    warning100: '35 85% 48%',
    warning200: '35 80% 40%',
    warningBg: '35 70% 93%',
    danger000: '350 65% 45%',
    danger100: '350 70% 55%',
    danger200: '350 75% 62%',
    dangerBg: '350 60% 95%',
    danger900: '350 50% 92%',
    info100: '200 70% 50%',
    info200: '200 65% 58%',
    infoBg: '200 60% 95%',
  },
  border: {
    border100: '350 15% 88%',
    border200: '350 12% 84%',
    border300: '350 10% 78%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

const sakuraDark: ThemeColors = {
  background: {
    bg000: '340 15% 18%',
    bg100: '340 15% 14%',
    bg200: '340 12% 11%',
    bg300: '340 10% 9%',
    bg400: '340 8% 6%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '350 15% 92%',
    text200: '350 10% 72%',
    text300: '350 8% 58%',
    text400: '350 6% 48%',
    text500: '350 5% 38%',
    text600: '350 4% 28%',
  },
  accent: {
    brand: '340 65% 60%',
    main000: '340 60% 52%',
    main100: '340 65% 60%',
    main200: '340 70% 68%',
    secondary100: '320 55% 62%',
  },
  semantic: {
    success100: '140 55% 52%',
    success200: '140 50% 60%',
    successBg: '140 35% 14%',
    warning100: '35 85% 58%',
    warning200: '35 80% 65%',
    warningBg: '35 30% 14%',
    danger000: '350 75% 62%',
    danger100: '350 70% 58%',
    danger200: '350 72% 68%',
    dangerBg: '350 30% 14%',
    danger900: '350 25% 22%',
    info100: '200 75% 62%',
    info200: '200 70% 70%',
    infoBg: '200 30% 14%',
  },
  border: {
    border100: '340 10% 24%',
    border200: '340 8% 28%',
    border300: '340 6% 34%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

export const sakuraTheme: ThemePreset = {
  id: 'sakura',
  name: 'Sakura',
  description: 'Soft pink tones, gentle and warm',
  light: sakuraLight,
  dark: sakuraDark,
}

// ============================================
// Ocean 主题 - 蓝白色系
// ============================================

const oceanLight: ThemeColors = {
  background: {
    bg000: '215 40% 99%',
    bg100: '215 35% 97%',
    bg200: '215 30% 94%',
    bg300: '215 25% 90%',
    bg400: '215 20% 86%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '220 25% 15%',
    text200: '220 20% 35%',
    text300: '220 15% 50%',
    text400: '220 12% 62%',
    text500: '220 10% 72%',
    text600: '220 8% 82%',
  },
  accent: {
    brand: '215 80% 52%',
    main000: '215 75% 45%',
    main100: '215 80% 52%',
    main200: '215 85% 58%',
    secondary100: '200 70% 50%',
  },
  semantic: {
    success100: '155 60% 40%',
    success200: '155 55% 32%',
    successBg: '155 50% 94%',
    warning100: '40 90% 48%',
    warning200: '35 85% 40%',
    warningBg: '40 80% 93%',
    danger000: '0 70% 45%',
    danger100: '0 75% 55%',
    danger200: '0 80% 62%',
    dangerBg: '0 70% 95%',
    danger900: '0 55% 92%',
    info100: '215 80% 50%',
    info200: '215 75% 58%',
    infoBg: '215 70% 95%',
  },
  border: {
    border100: '215 20% 86%',
    border200: '215 18% 82%',
    border300: '215 15% 76%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

const oceanDark: ThemeColors = {
  background: {
    bg000: '220 30% 16%',
    bg100: '220 30% 12%',
    bg200: '220 28% 10%',
    bg300: '220 25% 8%',
    bg400: '220 20% 5%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '215 20% 92%',
    text200: '215 15% 72%',
    text300: '215 12% 58%',
    text400: '215 10% 48%',
    text500: '215 8% 38%',
    text600: '215 6% 28%',
  },
  accent: {
    brand: '215 75% 58%',
    main000: '215 70% 50%',
    main100: '215 75% 58%',
    main200: '215 80% 65%',
    secondary100: '200 65% 60%',
  },
  semantic: {
    success100: '155 65% 55%',
    success200: '155 60% 62%',
    successBg: '155 35% 14%',
    warning100: '40 90% 60%',
    warning200: '40 85% 68%',
    warningBg: '40 30% 14%',
    danger000: '0 80% 62%',
    danger100: '0 75% 58%',
    danger200: '0 78% 68%',
    dangerBg: '0 30% 14%',
    danger900: '0 25% 22%',
    info100: '215 80% 62%',
    info200: '215 75% 70%',
    infoBg: '215 30% 14%',
  },
  border: {
    border100: '220 15% 22%',
    border200: '220 12% 26%',
    border300: '220 10% 32%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

export const oceanTheme: ThemePreset = {
  id: 'ocean',
  name: 'Ocean',
  description: 'Deep blue tones, calm and focused',
  light: oceanLight,
  dark: oceanDark,
}

// ============================================
// Obsidian 主题 - 纯黑高对比
// ============================================

const obsidianLight: ThemeColors = {
  background: {
    bg000: '0 0% 100%',
    bg100: '0 0% 99%',
    bg200: '0 0% 98%',
    bg300: '0 0% 96%',
    bg400: '0 0% 89%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '0 0% 13%',
    text200: '0 0% 35%',
    text300: '0 0% 44%',
    text400: '0 0% 67%',
    text500: '0 0% 74%',
    text600: '0 0% 83%',
  },
  accent: {
    brand: '254 80% 68%',
    main000: '255 82% 63%',
    main100: '254 80% 68%',
    main200: '258 100% 75%',
    secondary100: '212 93% 45%',
  },
  semantic: {
    success100: '144 92% 38%',
    success200: '144 92% 32%',
    successBg: '144 70% 94%',
    warning100: '30 100% 46%',
    warning200: '31 79% 58%',
    warningBg: '46 100% 94%',
    danger000: '353 81% 48%',
    danger100: '353 81% 55%',
    danger200: '358 96% 63%',
    dangerBg: '353 100% 96%',
    danger900: '353 70% 92%',
    info100: '212 93% 45%',
    info200: '212 100% 50%',
    infoBg: '212 100% 96%',
  },
  border: {
    border100: '0 0% 89%',
    border200: '0 0% 88%',
    border300: '0 0% 83%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

const obsidianDark: ThemeColors = {
  background: {
    bg000: '0 0% 12%',
    bg100: '0 0% 13%',
    bg200: '0 0% 14%',
    bg300: '0 0% 15%',
    bg400: '0 0% 16%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '0 0% 85%',
    text200: '0 0% 73%',
    text300: '0 0% 60%',
    text400: '0 0% 40%',
    text500: '0 0% 33%',
    text600: '0 0% 25%',
  },
  accent: {
    brand: '254 80% 68%',
    main000: '255 82% 63%',
    main100: '254 80% 68%',
    main200: '258 100% 75%',
    secondary100: '212 100% 50%',
  },
  semantic: {
    success100: '138 59% 54%',
    success200: '138 59% 60%',
    successBg: '138 24% 18%',
    warning100: '31 79% 58%',
    warning200: '59 64% 66%',
    warningBg: '46 24% 18%',
    danger000: '358 96% 58%',
    danger100: '358 96% 63%',
    danger200: '358 96% 69%',
    dangerBg: '353 22% 18%',
    danger900: '353 18% 24%',
    info100: '212 100% 50%',
    info200: '212 100% 58%',
    infoBg: '212 24% 18%',
  },
  border: {
    border100: '0 0% 16%',
    border200: '0 0% 21%',
    border300: '0 0% 25%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

export const obsidianTheme: ThemePreset = {
  id: 'obsidian',
  name: 'Obsidian',
  description: 'Default Obsidian-inspired grayscale with purple accent',
  light: obsidianLight,
  dark: obsidianDark,
}

// ============================================
// Theme Registry
// ============================================

export const builtinThemes: ThemePreset[] = [
  eucalyptusTheme,
  claudeTheme,
  breezeTheme,
  sakuraTheme,
  oceanTheme,
  obsidianTheme,
]

export function getThemePreset(id: string): ThemePreset | undefined {
  return builtinThemes.find(t => t.id === id)
}

/**
 * 将 ThemeColors 转换为 CSS 变量赋值字符串
 */
export function themeColorsToCSSVars(theme: ThemeColors): string {
  const lines: string[] = []

  // Background
  lines.push(`--bg-000: ${theme.background.bg000};`)
  lines.push(`--bg-100: ${theme.background.bg100};`)
  lines.push(`--bg-200: ${theme.background.bg200};`)
  lines.push(`--bg-300: ${theme.background.bg300};`)
  lines.push(`--bg-400: ${theme.background.bg400};`)

  // Text
  lines.push(`--text-000: ${theme.text.text000};`)
  lines.push(`--text-100: ${theme.text.text100};`)
  lines.push(`--text-200: ${theme.text.text200};`)
  lines.push(`--text-300: ${theme.text.text300};`)
  lines.push(`--text-400: ${theme.text.text400};`)
  lines.push(`--text-500: ${theme.text.text500};`)
  lines.push(`--text-600: ${theme.text.text600};`)

  // Accent
  lines.push(`--accent-brand: ${theme.accent.brand};`)
  lines.push(`--accent-main-000: ${theme.accent.main000};`)
  lines.push(`--accent-main-100: ${theme.accent.main100};`)
  lines.push(`--accent-main-200: ${theme.accent.main200};`)
  lines.push(`--accent-secondary-100: ${theme.accent.secondary100};`)

  // Semantic
  lines.push(`--success-100: ${theme.semantic.success100};`)
  lines.push(`--success-200: ${theme.semantic.success200};`)
  lines.push(`--success-bg: ${theme.semantic.successBg};`)
  lines.push(`--warning-100: ${theme.semantic.warning100};`)
  lines.push(`--warning-200: ${theme.semantic.warning200};`)
  lines.push(`--warning-bg: ${theme.semantic.warningBg};`)
  lines.push(`--danger-000: ${theme.semantic.danger000};`)
  lines.push(`--danger-100: ${theme.semantic.danger100};`)
  lines.push(`--danger-200: ${theme.semantic.danger200};`)
  lines.push(`--danger-bg: ${theme.semantic.dangerBg};`)
  lines.push(`--danger-900: ${theme.semantic.danger900};`)
  lines.push(`--info-100: ${theme.semantic.info100};`)
  lines.push(`--info-200: ${theme.semantic.info200};`)
  lines.push(`--info-bg: ${theme.semantic.infoBg};`)

  // Border
  lines.push(`--border-100: ${theme.border.border100};`)
  lines.push(`--border-200: ${theme.border.border200};`)
  lines.push(`--border-300: ${theme.border.border300};`)

  // Special
  if (theme.special) {
    if (theme.special.alwaysBlack) lines.push(`--always-black: ${theme.special.alwaysBlack};`)
    if (theme.special.alwaysWhite) lines.push(`--always-white: ${theme.special.alwaysWhite};`)
    if (theme.special.oncolor100) lines.push(`--oncolor-100: ${theme.special.oncolor100};`)
  }

  return lines.join('\n  ')
}
