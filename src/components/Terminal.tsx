// ============================================
// Terminal - 单个 xterm 终端实例
// 使用 xterm.js + WebSocket 连接后端 PTY
// ============================================

import { useEffect, useRef, memo, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { getPtyConnectUrl, updatePtySession } from '../api/pty'
import { layoutStore } from '../store/layoutStore'

// ============================================
// 终端主题 - 与应用主题配合
// ============================================

// 获取 CSS 变量的实际 HSL 值并转换为 hex
function getHSLColor(varName: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!value) return ''
  
  // CSS 变量格式是 "h s% l%" 或 "h s l"
  const parts = value.split(/\s+/)
  if (parts.length < 3) return ''
  
  const h = parseFloat(parts[0])
  const s = parseFloat(parts[1]) / 100
  const l = parseFloat(parts[2]) / 100
  
  // HSL to RGB
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function getTerminalTheme(isDark: boolean) {
  const fgColor = getHSLColor('--text-100') || (isDark ? '#e8e0d5' : '#2d2a26')
  
  // 背景色设置为透明，实际上由 CSS 强制覆盖，
  // 但这里设置 transparent 可以让 xterm 内部逻辑知道它是透明的
  if (isDark) {
    return {
      background: '#00000000', // 完全透明
      foreground: fgColor,
      cursor: '#e8e0d5',
      cursorAccent: '#1a1a1a',
      selectionBackground: '#4a4540',
      selectionForeground: '#e8e0d5',
      selectionInactiveBackground: '#3a3530',
      // ANSI colors - 暖色调适配
      black: '#1a1a1a',
      red: '#e55561',
      green: '#8cc265',
      yellow: '#d4a656',
      blue: '#6cb6ff',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#ff6b7a',
      brightGreen: '#a8e075',
      brightYellow: '#e5b567',
      brightBlue: '#82cfff',
      brightMagenta: '#de8ef0',
      brightCyan: '#70d0dc',
      brightWhite: '#ffffff',
    }
  } else {
    return {
      background: '#00000000', // 完全透明
      foreground: fgColor,
      cursor: '#2d2a26',
      cursorAccent: '#f5f3ef',
      selectionBackground: '#d5d0c8',
      selectionForeground: '#2d2a26',
      selectionInactiveBackground: '#e5e0d8',
      // ANSI colors - 浅色模式
      black: '#2d2a26',
      red: '#c9514a',
      green: '#4a9f4a',
      yellow: '#b58900',
      blue: '#3a7fc9',
      magenta: '#a04a9f',
      cyan: '#3a9f9f',
      white: '#f5f3ef',
      brightBlack: '#6b6560',
      brightRed: '#e55561',
      brightGreen: '#6ab56a',
      brightYellow: '#d4a020',
      brightBlue: '#5a9fe0',
      brightMagenta: '#c06abf',
      brightCyan: '#5abfbf',
      brightWhite: '#ffffff',
    }
  }
}

function isDarkMode(): boolean {
  const mode = document.documentElement.getAttribute('data-mode')
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// 检查是否为移动设备
function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}

// ============================================
// Terminal Component
// ============================================

interface TerminalProps {
  ptyId: string
  directory?: string
  isActive: boolean
}

export const Terminal = memo(function Terminal({
  ptyId,
  directory,
  isActive,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const resizeTimeoutRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const isPanelResizingRef = useRef(false)
  const [hasBeenActive, setHasBeenActive] = useState(isActive)

  // 当 tab 第一次变为活动状态时，标记它
  useEffect(() => {
    if (isActive && !hasBeenActive) {
      setHasBeenActive(true)
    }
  }, [isActive, hasBeenActive])

  // 初始化终端
  useEffect(() => {
    if (!containerRef.current) return
    if (!hasBeenActive) return
    
    mountedRef.current = true
    let ws: WebSocket | null = null
    let wsConnectTimeout: number | null = null

    const isMobile = isMobileDevice()
    const theme = getTerminalTheme(isDarkMode())
    
    const terminal = new XTerm({
      theme,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      fontSize: isMobile ? 14 : 13,
      lineHeight: isMobile ? 1.3 : 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
      allowTransparency: true, // 开启透明背景
      ...(isMobile ? {
        scrollSensitivity: 2,
        macOptionIsMeta: true,
        disableStdin: false,
      } : {})
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)

    terminal.open(containerRef.current)
    
    requestAnimationFrame(() => {
      if (mountedRef.current) {
        fitAddon.fit()
      }
    })

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // 连接 WebSocket
    const connectWs = () => {
      if (!mountedRef.current) return
      
      fitAddon.fit()
      
      const wsUrl = getPtyConnectUrl(ptyId, directory)
      console.log('[Terminal] Connecting to:', wsUrl)
      ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('[Terminal] WebSocket connected:', ptyId)
        if (!mountedRef.current) return
        layoutStore.updateTerminalTab(ptyId, { status: 'connected' })
        const { cols, rows } = terminal
        console.log('[Terminal] Sending size:', cols, 'x', rows)
        updatePtySession(ptyId, { size: { cols, rows } }, directory).catch(() => {})
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current) return
        terminal.write(event.data)
      }

      ws.onclose = (e) => {
        console.log('[Terminal] WebSocket closed:', ptyId, e.code, e.reason)
        if (!mountedRef.current) return
        layoutStore.updateTerminalTab(ptyId, { status: 'disconnected' })
        terminal.write('\r\n\x1b[90m[Connection closed]\x1b[0m\r\n')
      }

      ws.onerror = (e) => {
        console.log('[Terminal] WebSocket error:', ptyId, e)
        if (!mountedRef.current) return
        layoutStore.updateTerminalTab(ptyId, { status: 'disconnected' })
      }

      terminal.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data)
        }
      })
    }
    
    wsConnectTimeout = requestAnimationFrame(connectWs) as unknown as number

    terminal.onTitleChange((title) => {
      if (!mountedRef.current) return
      layoutStore.updateTerminalTab(ptyId, { title })
    })

    return () => {
      mountedRef.current = false
      if (wsConnectTimeout) {
        cancelAnimationFrame(wsConnectTimeout)
      }
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
        resizeTimeoutRef.current = null
      }
      if (ws) {
        ws.close()
      }
      // 置空 refs 防止内存泄漏
      wsRef.current = null
      // 显式 dispose addons
      fitAddon.dispose()
      webLinksAddon.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [ptyId, directory, hasBeenActive])

  // 处理大小变化
  useEffect(() => {
    if (!isActive || !fitAddonRef.current || !terminalRef.current) return

    const handleResize = () => {
      if (isPanelResizingRef.current) return
      
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = window.setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current && !isPanelResizingRef.current) {
          fitAddonRef.current.fit()
          const { cols, rows } = terminalRef.current
          updatePtySession(ptyId, { size: { cols, rows } }, directory).catch(() => {})
        }
      }, 16)
    }

    window.addEventListener('resize', handleResize)
    const resizeObserver = new ResizeObserver(handleResize)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }
    
    const handlePanelResizeStart = () => {
      isPanelResizingRef.current = true
    }
    window.addEventListener('panel-resize-start', handlePanelResizeStart)

    handleResize()

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('panel-resize-start', handlePanelResizeStart)
      resizeObserver.disconnect()
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
    }
  }, [isActive, ptyId, directory])

  // 主题变化时更新
  useEffect(() => {
    const handleThemeChange = () => {
      if (terminalRef.current) {
        terminalRef.current.options.theme = getTerminalTheme(isDarkMode())
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-mode') {
          handleThemeChange()
          break
        }
      }
    })

    observer.observe(document.documentElement, { attributes: true })

    return () => observer.disconnect()
  }, [])

  // 当 tab 变为活动状态时，聚焦并重新 fit
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus()
      if (fitAddonRef.current) {
        requestAnimationFrame(() => {
          fitAddonRef.current?.fit()
        })
      }
    }
  }, [isActive])

  // 监听面板 resize 结束事件
  useEffect(() => {
    if (!isActive) return
    
    const handlePanelResizeEnd = () => {
      isPanelResizingRef.current = false
      if (fitAddonRef.current && terminalRef.current) {
        requestAnimationFrame(() => {
          if (!fitAddonRef.current || !terminalRef.current) return
          fitAddonRef.current.fit()
          const { cols, rows } = terminalRef.current
          updatePtySession(ptyId, { size: { cols, rows } }, directory).catch(() => {})
        })
      }
    }
    
    window.addEventListener('panel-resize-end', handlePanelResizeEnd)
    return () => window.removeEventListener('panel-resize-end', handlePanelResizeEnd)
  }, [isActive, ptyId, directory])

  const isMobile = isMobileDevice()

  return (
    <>
      <style>{`
        /* 强制隐藏 xterm 滚动条 */
        .xterm-viewport::-webkit-scrollbar {
          display: none;
        }
        /* 强制覆盖 xterm 内部元素的背景色为透明 */
        .xterm-viewport, 
        .xterm-screen, 
        .xterm-scrollable-element {
          background-color: transparent !important;
        }
        /* 确保终端本身无 padding */
        .xterm {
          padding: 0 !important;
        }
      `}</style>
      <div
        ref={containerRef}
        className="h-full w-full bg-bg-100" // 统一使用主题背景色
        style={{
          padding: isMobile ? '0' : '4px 0 0 4px', // 极简 padding
          visibility: isActive ? 'visible' : 'hidden',
          position: isActive ? 'relative' : 'absolute',
          pointerEvents: isActive ? 'auto' : 'none',
        }}
        onClick={() => {
          if (isMobile && terminalRef.current) {
            terminalRef.current.focus()
          }
        }}
        onTouchEnd={(e) => {
          if (terminalRef.current && e.target === containerRef.current) {
            terminalRef.current.focus()
          }
        }}
      />
    </>
  )
})
