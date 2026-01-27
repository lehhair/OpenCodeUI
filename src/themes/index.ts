/**
 * 主题系统配置
 * 
 * 使用说明：
 * 1. 所有颜色值使用 HSL 格式（不带 hsl() 包装）
 * 2. 格式：'色相 饱和度% 亮度%'，例如：'210 90% 50%'
 * 3. 添加新主题时复制现有主题结构并修改颜色值
 * 4. 在 index.css 中添加对应的 CSS 变量定义
 */

export interface ThemeColors {
  /** 背景色 */
  background: {
    bg000: string  // 最亮/最暗背景
    bg100: string  // 次级背景
    bg200: string  // 卡片/面板背景
    bg300: string  // 悬停背景
    bg400: string  // 激活背景
  }
  
  /** 文本色 */
  text: {
    text000: string  // 反色文本（白/黑）
    text100: string  // 主要文本
    text200: string  // 次要文本
    text300: string  // 辅助文本
    text400: string  // 占位符
    text500: string  // 禁用
    text600: string  // 分隔线
  }
  
  /** 品牌色 */
  accent: {
    brand: string        // 品牌主色
    main000: string      // 主色调深色
    main100: string      // 主色调
    main200: string      // 主色调浅色
    secondary100: string // 次要强调色
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
}

/**
 * 浅色主题 - 现代简约风格
 * 纯净的灰白色系，高对比度，适合长时间阅读
 */
export const lightTheme: ThemeColors = {
  background: {
    bg000: '0 0% 100%',    // 纯白
    bg100: '0 0% 98%',     // 极浅灰
    bg200: '0 0% 96%',     // 浅灰
    bg300: '0 0% 94%',     // 中浅灰
    bg400: '0 0% 90%',     // 中灰
  },
  text: {
    text000: '0 0% 100%',  // 纯白（on-dark）
    text100: '0 0% 8%',    // 主文本 - 深黑
    text200: '0 0% 25%',   // 次要文本 - 深灰
    text300: '0 0% 45%',   // 辅助文本 - 中灰
    text400: '0 0% 60%',   // 占位符 - 浅灰
    text500: '0 0% 70%',   // 禁用 - 很浅
    text600: '0 0% 85%',   // 分隔线 - 极浅
  },
  accent: {
    brand: '24 90% 55%',
    main000: '24 85% 50%',
    main100: '24 90% 55%',
    main200: '24 95% 60%',
    secondary100: '210 90% 50%',
  },
  semantic: {
    success100: '142 75% 42%',
    success200: '142 70% 35%',
    successBg: '142 70% 96%',
    warning100: '38 95% 50%',
    warning200: '32 90% 45%',
    warningBg: '48 95% 94%',
    danger000: '0 70% 40%',
    danger100: '0 75% 50%',
    danger200: '0 80% 60%',
    dangerBg: '0 80% 96%',
    danger900: '0 60% 94%',
    info100: '210 90% 50%',
    info200: '210 85% 60%',
    infoBg: '210 100% 96%',
  },
  border: {
    border100: '0 0% 85%',
    border200: '0 0% 88%',
    border300: '0 0% 80%',
  },
}

/**
 * 深色主题 - 温暖深色风格
 * 带轻微暖色调的深色背景，减少眼睛疲劳
 */
export const darkTheme: ThemeColors = {
  background: {
    bg000: '30 3% 20%',    // 深色背景
    bg100: '30 3% 15%',    // 次级深色
    bg200: '30 3% 12%',    // 卡片背景
    bg300: '30 3% 9%',     // 悬停背景
    bg400: '0 0% 5%',      // 激活背景
  },
  text: {
    text000: '0 0% 100%',  // 纯白
    text100: '40 20% 95%', // 主文本 - 暖白
    text200: '40 10% 75%', // 次要文本
    text300: '40 5% 60%',  // 辅助文本
    text400: '40 3% 50%',  // 占位符
    text500: '40 2% 40%',  // 禁用
    text600: '40 2% 30%',  // 分隔线
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
}

/**
 * 主题注册表
 * 
 * 添加新主题步骤：
 * 1. 在上面定义新的主题常量（参考 lightTheme/darkTheme）
 * 2. 在这里注册主题
 * 3. 在 index.css 中添加对应的 CSS 变量定义
 * 4. （可选）在 useTheme.ts 中扩展 ThemeMode 类型
 */
export const themes = {
  light: lightTheme,
  dark: darkTheme,
  // 未来可以添加：
  // ocean: oceanTheme,
  // forest: forestTheme,
  // sunset: sunsetTheme,
} as const

export type ThemeName = keyof typeof themes

/**
 * 获取主题配置
 */
export function getTheme(name: ThemeName): ThemeColors {
  return themes[name]
}

/**
 * 生成 CSS 变量字符串（用于动态主题切换）
 */
export function generateCSSVariables(theme: ThemeColors): string {
  return `
    --bg-000: ${theme.background.bg000};
    --bg-100: ${theme.background.bg100};
    --bg-200: ${theme.background.bg200};
    --bg-300: ${theme.background.bg300};
    --bg-400: ${theme.background.bg400};
    
    --text-000: ${theme.text.text000};
    --text-100: ${theme.text.text100};
    --text-200: ${theme.text.text200};
    --text-300: ${theme.text.text300};
    --text-400: ${theme.text.text400};
    --text-500: ${theme.text.text500};
    --text-600: ${theme.text.text600};
    
    --accent-brand: ${theme.accent.brand};
    --accent-main-000: ${theme.accent.main000};
    --accent-main-100: ${theme.accent.main100};
    --accent-main-200: ${theme.accent.main200};
    --accent-secondary-100: ${theme.accent.secondary100};
    
    --success-100: ${theme.semantic.success100};
    --success-200: ${theme.semantic.success200};
    --success-bg: ${theme.semantic.successBg};
    --warning-100: ${theme.semantic.warning100};
    --warning-200: ${theme.semantic.warning200};
    --warning-bg: ${theme.semantic.warningBg};
    --danger-000: ${theme.semantic.danger000};
    --danger-100: ${theme.semantic.danger100};
    --danger-200: ${theme.semantic.danger200};
    --danger-bg: ${theme.semantic.dangerBg};
    --danger-900: ${theme.semantic.danger900};
    --info-100: ${theme.semantic.info100};
    --info-200: ${theme.semantic.info200};
    --info-bg: ${theme.semantic.infoBg};
    
    --border-100: ${theme.border.border100};
    --border-200: ${theme.border.border200};
    --border-300: ${theme.border.border300};
  `.trim()
}
