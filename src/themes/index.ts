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

const draculaLight: ThemeColors = {
  background: {
    bg000: '48 100% 96%',
    bg100: '48 88% 94%',
    bg200: '45 52% 90%',
    bg300: '240 19% 88%',
    bg400: '240 19% 84%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '0 0% 12%',
    text200: '49 18% 36%',
    text300: '46 14% 46%',
    text400: '45 12% 58%',
    text500: '240 19% 84%',
    text600: '240 19% 88%',
  },
  accent: {
    brand: '252 54% 54%',
    main000: '336 78% 36%',
    main100: '252 54% 54%',
    main200: '265 89% 78%',
    secondary100: '198 96% 30%',
  },
  semantic: {
    success100: '114 84% 24%',
    success200: '120 90% 30%',
    successBg: '48 100% 96%',
    warning100: '24 78% 36%',
    warning200: '54 78% 36%',
    warningBg: '48 100% 96%',
    danger000: '6 66% 48%',
    danger100: '12 72% 54%',
    danger200: '0 100% 67%',
    dangerBg: '48 100% 96%',
    danger900: '240 19% 84%',
    info100: '198 96% 30%',
    info200: '204 100% 42%',
    infoBg: '48 100% 96%',
  },
  border: {
    border100: '240 19% 88%',
    border200: '240 19% 84%',
    border300: '49 18% 36%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

const draculaDark: ThemeColors = {
  background: {
    bg000: '231 15% 18%',
    bg100: '233 16% 16%',
    bg200: '233 17% 14%',
    bg300: '233 18% 12%',
    bg400: '233 20% 10%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '60 30% 96%',
    text200: '60 23% 90%',
    text300: '225 27% 51%',
    text400: '228 16% 62%',
    text500: '232 14% 31%',
    text600: '233 17% 14%',
  },
  accent: {
    brand: '265 89% 78%',
    main000: '258 60% 60%',
    main100: '265 89% 78%',
    main200: '265 89% 78%',
    secondary100: '225 27% 51%',
  },
  semantic: {
    success100: '135 94% 65%',
    success200: '120 90% 30%',
    successBg: '235 14% 15%',
    warning100: '31 100% 71%',
    warning200: '54 78% 36%',
    warningBg: '235 14% 15%',
    danger000: '0 100% 67%',
    danger100: '12 72% 54%',
    danger200: '0 100% 67%',
    dangerBg: '235 14% 15%',
    danger900: '230 15% 24%',
    info100: '191 97% 77%',
    info200: '204 100% 42%',
    infoBg: '235 14% 15%',
  },
  border: {
    border100: '232 14% 31%',
    border200: '232 14% 31%',
    border300: '225 27% 51%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

export const draculaTheme: ThemePreset = {
  id: 'dracula',
  name: 'Dracula',
  description: 'Official Dracula preset with Alucard day and monochrome night',
  light: draculaLight,
  dark: draculaDark,
}

// ============================================
// Obsidian 主题 - 纯黑高对比
// ============================================

const obsidianLight: ThemeColors = {
  background: {
    bg000: '0 0% 100%',
    bg100: '0 0% 98%',
    bg200: '0 0% 95%',
    bg300: '0 0% 91%',
    bg400: '0 0% 86%',
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
    bg000: '0 0% 16%',
    bg100: '0 0% 13%',
    bg200: '0 0% 10%',
    bg300: '0 0% 8%',
    bg400: '0 0% 5%',
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
// GitHub 主题 - Primer 设计系统
// ============================================
// 颜色来源：primer/primitives + primer/github-vscode-theme
// - Light canvas/inset #ffffff / #f6f8fa，accent #0969da，fg #1f2328
// - Dark canvas #0d1117 / surface #21262d，accent #2f81f7，fg #e6edf3

const githubLight: ThemeColors = {
  background: {
    bg000: '0 0% 100%', // canvas.default #ffffff
    bg100: '210 29% 97%', // canvas.inset #f6f8fa
    bg200: '210 24% 93%', // neutral.subtle #eaeef2
    bg300: '210 18% 84%', // border.default #d0d7de
    bg400: '210 13% 72%', // neutral.emphasis #afb8c1
  },
  text: {
    text000: '0 0% 100%',
    text100: '213 13% 14%', // fg.default #1f2328
    text200: '212 8% 43%', // fg.muted #656d76
    text300: '212 8% 47%', // fg.subtle #6e7781
    text400: '215 8% 62%', // fg.disabled #8c959f
    text500: '215 8% 75%',
    text600: '215 8% 84%',
  },
  accent: {
    brand: '212 92% 45%', // accent.fg #0969da
    main000: '212 90% 40%',
    main100: '212 92% 45%',
    main200: '211 100% 56%', // accent.bright #218bff
    secondary100: '261 69% 59%', // done.fg #8250df
  },
  semantic: {
    success100: '137 66% 30%', // success.fg #1a7f37
    success200: '137 63% 25%',
    successBg: '133 80% 92%', // success.subtle #dafbe1
    warning100: '40 100% 30%', // attention.fg #9a6700
    warning200: '41 95% 25%',
    warningBg: '53 100% 89%', // attention.subtle #fff8c5
    danger000: '356 72% 47%', // danger.fg #cf222e
    danger100: '356 72% 47%',
    danger200: '356 70% 40%',
    dangerBg: '5 100% 96%', // danger.subtle #ffebe9
    danger900: '5 80% 92%',
    info100: '212 92% 45%',
    info200: '211 100% 56%',
    infoBg: '199 100% 93%', // accent.subtle #ddf4ff
  },
  border: {
    border100: '210 18% 84%', // border.default #d0d7de
    border200: '210 18% 87%', // border.muted #d8dee4
    border300: '210 13% 72%', // neutral #afb8c1
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

const githubDark: ThemeColors = {
  background: {
    bg000: '215 15% 15%', // surface #21262d
    bg100: '215 21% 11%', // canvas.subtle #161b22
    bg200: '216 28% 7%', // canvas.default #0d1117
    bg300: '218 80% 4%',
    bg400: '218 80% 2%', // canvas.inset #010409
  },
  text: {
    text000: '0 0% 100%',
    text100: '208 35% 93%', // fg.default #e6edf3
    text200: '215 8% 53%', // fg.muted #7d8590
    text300: '215 8% 43%',
    text400: '215 7% 35%',
    text500: '215 6% 28%',
    text600: '215 5% 22%',
  },
  accent: {
    brand: '215 93% 58%', // accent.fg #2f81f7
    main000: '216 84% 52%', // accent.emphasis #1f6feb
    main100: '215 93% 58%',
    main200: '215 93% 67%',
    secondary100: '262 89% 71%', // done.fg #a371f7
  },
  semantic: {
    success100: '128 49% 49%', // success.fg #3fb950
    success200: '128 50% 60%',
    successBg: '141 90% 12%', // success.subtle #033a16
    warning100: '41 72% 48%', // attention.fg #d29922
    warning200: '41 75% 58%',
    warningBg: '29 34% 17%', // attention.subtle
    danger000: '3 93% 63%', // danger.fg #f85149
    danger100: '3 90% 60%',
    danger200: '3 90% 68%',
    dangerBg: '352 70% 17%', // danger.subtle
    danger900: '352 60% 25%',
    info100: '215 93% 58%',
    info200: '215 93% 68%',
    infoBg: '219 80% 23%', // accent.subtle
  },
  border: {
    border100: '212 12% 21%', // border.default #30363d
    border200: '215 15% 15%', // border.muted #21262d
    border300: '212 12% 30%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

export const githubTheme: ThemePreset = {
  id: 'github',
  name: 'GitHub',
  description: 'Primer palette, signature GitHub blue on neutral canvas',
  light: githubLight,
  dark: githubDark,
}

// ============================================
// One 主题 - Atom One Dark / Light
// ============================================
// 颜色来源：base16 one-light-scheme + onedark (verbatim base00–base0F)
// - Light #fafafa 底，accent = base0B string green #50a14f（也是 inline code 色），fg #383a42
// - Dark  #282c34 底，accent = base0B string green #98c379，fg #abb2bf
// 注：OpenCodeUI 把 brand 与 inline code 都绑在 accent.main100 上，所以选了 Atom
// 最具辨识度的 string green 当 brand；secondary 退回 base0D blue（function hue）。

const oneLight: ThemeColors = {
  background: {
    bg000: '0 0% 100%',
    bg100: '0 0% 98%', // base00 #fafafa
    bg200: '240 3% 94%', // base01 #f0f0f1
    bg300: '240 2% 90%', // base02 #e5e5e6
    bg400: '231 4% 80%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '228 8% 24%', // base05 #383a42
    text200: '227 6% 44%', // base04 #696c77
    text300: '231 4% 64%', // base03 #a0a1a7
    text400: '230 4% 75%',
    text500: '230 3% 85%',
    text600: '230 3% 90%',
  },
  accent: {
    brand: '119 34% 47%', // base0B #50a14f (string green)
    main000: '119 35% 38%',
    main100: '119 34% 47%',
    main200: '119 38% 55%',
    secondary100: '221 87% 60%', // base0D #4078f2 (function blue)
  },
  semantic: {
    success100: '119 34% 47%', // base0B #50a14f
    success200: '119 35% 35%',
    successBg: '120 30% 92%',
    warning100: '41 99% 38%', // base0A #c18401
    warning200: '41 90% 30%',
    warningBg: '42 100% 92%',
    danger000: '344 84% 43%', // base08 #ca1243
    danger100: '344 84% 43%',
    danger200: '344 80% 50%',
    dangerBg: '345 70% 95%',
    danger900: '345 50% 92%',
    info100: '198 99% 37%', // base0C #0184bc
    info200: '198 90% 47%',
    infoBg: '199 80% 95%',
  },
  border: {
    border100: '240 2% 90%', // base02 #e5e5e6
    border200: '240 3% 94%', // base01 #f0f0f1
    border300: '228 8% 80%',
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

const oneDark: ThemeColors = {
  background: {
    bg000: '218 13% 24%', // base01 #353b45
    bg100: '220 13% 18%', // base00 #282c34
    bg200: '220 14% 14%',
    bg300: '220 14% 10%',
    bg400: '220 14% 6%',
  },
  text: {
    text000: '0 0% 100%',
    text100: '219 14% 71%', // base05 #abb2bf
    text200: '219 12% 60%',
    text300: '219 10% 50%',
    text400: '223 8% 38%', // base04 #565c64
    text500: '220 6% 30%',
    text600: '220 5% 22%',
  },
  accent: {
    brand: '95 38% 62%', // base0B #98c379 (string green)
    main000: '95 38% 52%',
    main100: '95 38% 62%',
    main200: '95 42% 70%',
    secondary100: '207 82% 66%', // base0D #61afef (function blue)
  },
  semantic: {
    success100: '95 38% 62%', // base0B #98c379
    success200: '95 35% 70%',
    successBg: '95 30% 15%',
    warning100: '39 67% 69%', // base0A #e5c07b
    warning200: '39 65% 75%',
    warningBg: '39 30% 15%',
    danger000: '355 65% 65%', // base08 #e06c75
    danger100: '355 65% 65%',
    danger200: '355 60% 72%',
    dangerBg: '355 40% 15%',
    danger900: '355 30% 22%',
    info100: '187 47% 55%', // base0C #56b6c2
    info200: '187 50% 62%',
    infoBg: '187 40% 15%',
  },
  border: {
    border100: '220 14% 24%',
    border200: '220 13% 20%',
    border300: '218 13% 28%', // base02 #3e4451
  },
  special: {
    alwaysBlack: '0 0% 0%',
    alwaysWhite: '0 0% 100%',
    oncolor100: '0 0% 100%',
  },
}

export const oneTheme: ThemePreset = {
  id: 'one',
  name: 'One',
  description: 'Atom One palette, string-green accent with five-color syntax tones',
  light: oneLight,
  dark: oneDark,
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
  draculaTheme,
  obsidianTheme,
  githubTheme,
  oneTheme,
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
