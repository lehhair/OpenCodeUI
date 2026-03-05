// ============================================
// Kbd - 键盘快捷键徽章组件
// ============================================

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5
                    text-[11px] font-mono font-medium leading-none
                    bg-bg-100 text-text-300 border border-border-200 rounded
                    shadow-[0_1px_0_0_var(--border-200)]">
      {children}
    </kbd>
  )
}
