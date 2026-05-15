// ============================================
// Terminal - 单个 xterm 终端实例
// 使用 xterm.js + WebSocket 连接后端 PTY
// ============================================

import { useEffect, useRef, memo, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { getPtyConnectUrl, updatePtySession } from '../api/pty'
import { useTheme } from '../hooks'
import { layoutStore, useLayoutStore } from '../store/layoutStore'
import { useInputCapabilities } from '../hooks/useInputCapabilities'
import { logger } from '../utils/logger'
import { parsePtyFrame } from '../utils/ptyProtocol'
import { isTauri } from '../utils/tauri'
import { copyTextToClipboard, readTextFromClipboard } from '../utils/clipboard'

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
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
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

// ============================================
// Mobile Extra Keys Toolbar
// 参考 Termux / Moshi / Blink Shell 业界方案
// CTRL / ALT 为粘滞修饰键，支持同时激活，下一次按键自动附带
// ============================================

type ModifierKey = 'ctrl' | 'alt'

type StickyModifiers = Record<ModifierKey, boolean>

function createStickyModifiers(): StickyModifiers {
  return { ctrl: false, alt: false }
}

interface MobileExtraKey {
  data?: string
  label: string
  modifier?: ModifierKey
}

const MOBILE_EXTRA_KEY_ROWS: MobileExtraKey[][] = [
  [
    { label: 'ESC', data: '\x1b' },
    { label: '/', data: '/' },
    { label: '-', data: '-' },
    { label: 'HOME', data: '\x1b[H' },
    { label: '↑', data: '\x1b[A' },
    { label: 'END', data: '\x1b[F' },
    { label: 'PGUP', data: '\x1b[5~' },
  ],
  [
    { label: 'TAB', data: '\t' },
    { label: 'CTRL', modifier: 'ctrl' },
    { label: 'ALT', modifier: 'alt' },
    { label: '←', data: '\x1b[D' },
    { label: '↓', data: '\x1b[B' },
    { label: '→', data: '\x1b[C' },
    { label: 'PGDN', data: '\x1b[6~' },
  ],
]

function toCtrlSequence(data: string): string {
  if (data.length !== 1) return data

  const upper = data.toUpperCase()
  if (upper >= 'A' && upper <= 'Z') {
    return String.fromCharCode(upper.charCodeAt(0) - 64)
  }

  switch (data) {
    case ' ':
    case '@':
    case '`':
      return '\x00'
    case '[':
      return '\x1b'
    case '\\':
      return '\x1c'
    case ']':
      return '\x1d'
    case '^':
      return '\x1e'
    case '_':
    case '/':
      return '\x1f'
    case '?':
      return '\x7f'
    default:
      return data
  }
}

function hasStickyModifier(sticky: StickyModifiers): boolean {
  return sticky.ctrl || sticky.alt
}

function applyStickyModifiers(data: string, sticky: StickyModifiers): string {
  let output = data
  if (sticky.ctrl) output = toCtrlSequence(output)
  if (sticky.alt) output = `\x1b${output}`
  return output
}

interface MobileExtraKeysProps {
  onFocusTerminal: () => void
  onSend: (data: string) => void
  onToggleSticky: (modifier: ModifierKey) => void
  stickyModifiers: StickyModifiers
}

function MobileExtraKeys({ onSend, stickyModifiers, onToggleSticky, onFocusTerminal }: MobileExtraKeysProps) {
  const toolbarGridStyle = { gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' } as const

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
  }, [])

  const handleSend = useCallback(
    (data: string) => {
      onSend(data)
      onFocusTerminal()
    },
    [onFocusTerminal, onSend],
  )

  const btnBase =
    'flex h-8 min-w-0 w-full items-center justify-center overflow-hidden whitespace-nowrap rounded-md border px-0 text-[length:var(--fs-xxs)] leading-none font-mono font-semibold tracking-[-0.02em] text-text-200 transition-[background-color,color,border-color,transform] duration-100 select-none active:scale-[0.98]'
  const btnNormal = `${btnBase} border-border-200/20 bg-bg-200/70 active:bg-bg-300/80`
  const btnActive = `${btnBase} border-accent-main-100/45 bg-accent-main-100/18 text-accent-main-100`

  return (
    <div
      className="w-full border-t border-border-200/40 bg-bg-100/95 supports-[backdrop-filter]:bg-bg-100/85 supports-[backdrop-filter]:backdrop-blur-sm"
      style={{ WebkitTextSizeAdjust: '100%', textSizeAdjust: '100%' }}
    >
      <div className="px-1 py-1">
        <div className="grid gap-0.5">
          {MOBILE_EXTRA_KEY_ROWS.map((row, rowIndex) => (
            <div key={rowIndex} className="grid w-full gap-0.5" style={toolbarGridStyle}>
              {row.map(key => {
                const isActive = key.modifier ? stickyModifiers[key.modifier] : false

                return (
                  <button
                    key={key.label}
                    type="button"
                    aria-pressed={isActive}
                    className={isActive ? btnActive : btnNormal}
                    onPointerDown={handlePointerDown}
                    onClick={() => {
                      if (key.modifier) {
                        onToggleSticky(key.modifier)
                        onFocusTerminal()
                        return
                      }
                      if (key.data) {
                        handleSend(key.data)
                      }
                    }}
                  >
                    <span className="block max-w-full overflow-hidden whitespace-nowrap text-center leading-none [text-wrap:nowrap]">
                      {key.label}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================
// Terminal Component
// ============================================

interface TerminalProps {
  ptyId: string
  directory?: string
  isActive: boolean
}

export const Terminal = memo(function Terminal({ ptyId, directory, isActive }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalDirectoryRef = useRef(directory)
  const [isTouchScrolling, setIsTouchScrolling] = useState(false)
  const [stickyModifiers, setStickyModifiers] = useState<StickyModifiers>(() => createStickyModifiers())
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const stickyModifiersRef = useRef<StickyModifiers>(createStickyModifiers())
  const cursorRef = useRef(0)
  const transportSendRef = useRef<((data: string) => void) | null>(null)
  const transportDisconnectRef = useRef<(() => void) | null>(null)
  const resizeTimeoutRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const isPanelResizingRef = useRef(false)
  const [hasBeenActive, setHasBeenActive] = useState(isActive)
  const { preferTouchUi, hasTouch, hasCoarsePointer } = useInputCapabilities()
  const { manualTerminalTitles } = useTheme()
  const { panelTabs } = useLayoutStore()
  const touchCapable = hasTouch || hasCoarsePointer
  const manualTerminalTitlesRef = useRef(manualTerminalTitles)
  const terminalTab = panelTabs.find(tab => tab.id === ptyId && tab.type === 'terminal')
  const restoreBuffer = typeof terminalTab?.buffer === 'string' ? terminalTab.buffer : ''
  const restoreScrollY = typeof terminalTab?.scrollY === 'number' ? terminalTab.scrollY : undefined
  const restoreCursor =
    typeof terminalTab?.cursor === 'number' && Number.isSafeInteger(terminalTab.cursor) && terminalTab.cursor >= 0
      ? terminalTab.cursor
      : 0
  const restoreCols =
    typeof terminalTab?.cols === 'number' && Number.isSafeInteger(terminalTab.cols) && terminalTab.cols > 0
      ? terminalTab.cols
      : undefined
  const restoreRows =
    typeof terminalTab?.rows === 'number' && Number.isSafeInteger(terminalTab.rows) && terminalTab.rows > 0
      ? terminalTab.rows
      : undefined

  const clearStickyModifiers = useCallback(() => {
    const next = createStickyModifiers()
    stickyModifiersRef.current = next
    setStickyModifiers(next)
  }, [])

  const toggleStickyModifier = useCallback((modifier: ModifierKey) => {
    setStickyModifiers(prev => {
      const next = { ...prev, [modifier]: !prev[modifier] }
      stickyModifiersRef.current = next
      return next
    })
  }, [])

  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus()
  }, [])

  const sendTerminalData = useCallback(
    (data: string) => {
      const sticky = stickyModifiersRef.current
      const outgoing = applyStickyModifiers(data, sticky)

      transportSendRef.current?.(outgoing)

      if (hasStickyModifier(sticky)) {
        clearStickyModifiers()
      }
    },
    [clearStickyModifiers],
  )

  useEffect(() => {
    manualTerminalTitlesRef.current = manualTerminalTitles
  }, [manualTerminalTitles])

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

    const restoreSize = restoreBuffer && restoreCols && restoreRows ? { cols: restoreCols, rows: restoreRows } : undefined

    mountedRef.current = true
    cursorRef.current = restoreCursor
    let ws: WebSocket | null = null
    let wsConnectTimeout: number | null = null
    let disposeData: { dispose: () => void } | null = null
    let disposeTitle: { dispose: () => void } | null = null
    const terminalDirectory = terminalDirectoryRef.current

    const touchUi = preferTouchUi
    const theme = getTerminalTheme(isDarkMode())

    // 从 CSS 变量读取终端字号（跟随 fontScale 设置）
    const rootStyle = getComputedStyle(document.documentElement)
    const termFontSize = parseInt(rootStyle.getPropertyValue('--fs-terminal').trim(), 10) || 13
    const termLineHeight = parseFloat(rootStyle.getPropertyValue('--fs-terminal-line-height').trim()) || 1.2

    const terminal = new XTerm({
      theme,
      fontFamily:
        rootStyle.getPropertyValue('--font-mono').trim() ||
        "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
      fontSize: touchUi ? Math.max(termFontSize, 14) : termFontSize,
      lineHeight: touchUi ? Math.max(termLineHeight, 1.3) : termLineHeight,
      cols: restoreSize?.cols,
      rows: restoreSize?.rows,
      cursorBlink: true,
      cursorStyle: 'block',
      smoothScrollDuration: touchUi ? 100 : 0,
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
      allowTransparency: true, // 开启透明背景
      ...(touchUi
        ? {
            scrollSensitivity: 2,
            macOptionIsMeta: true,
            disableStdin: false,
          }
        : {}),
    })

    const fitAddon = new FitAddon()
    const serializeAddon = new SerializeAddon()
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      if (isTauri()) {
        import('@tauri-apps/plugin-opener').then(mod => mod.openUrl(uri)).catch(() => window.open(uri))
      } else {
        window.open(uri)
      }
    })

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(serializeAddon)
    terminal.loadAddon(webLinksAddon)

    terminal.open(containerRef.current)

    // ---- 选中自动复制 + Ctrl+V / 右键粘贴 ----

    // 拦截 Ctrl+V / Cmd+V，改为从剪贴板粘贴而非发送 ^V
    terminal.attachCustomKeyEventHandler(ev => {
      if (ev.type !== 'keydown') return true
      const isPaste = (ev.ctrlKey || ev.metaKey) && ev.code === 'KeyV' && !ev.altKey
      if (isPaste) {
        ev.preventDefault() // 阻止浏览器原生粘贴到 textarea，避免重复
        readTextFromClipboard()
          .then(text => {
            if (text && mountedRef.current) {
              sendTerminalData(text)
            }
          })
          .catch(() => {})
        return false // 阻止 xterm 处理该按键
      }
      return true
    })

    // 鼠标释放时，若有选中内容则自动复制到剪贴板
    const handleSelectionCopy = () => {
      if (terminal.hasSelection()) {
        const selected = terminal.getSelection()
        if (selected) {
          copyTextToClipboard(selected).catch(() => {})
        }
      }
    }
    const terminalElement = terminal.element
    terminalElement?.addEventListener('mouseup', handleSelectionCopy)

    // 右键粘贴
    const handleContextMenuPaste = (e: MouseEvent) => {
      e.preventDefault()
      readTextFromClipboard()
        .then(text => {
          if (text && mountedRef.current) {
            sendTerminalData(text)
            terminal.focus()
          }
        })
        .catch(() => {})
    }
    terminalElement?.addEventListener('contextmenu', handleContextMenuPaste)

    // ---- end clipboard ----

    const textarea = terminal.textarea
    const handleTextareaBlur = () => clearStickyModifiers()
    if (touchUi && textarea) {
      textarea.setAttribute('autocapitalize', 'none')
      textarea.setAttribute('autocomplete', 'off')
      textarea.setAttribute('autocorrect', 'off')
      textarea.setAttribute('enterkeyhint', 'send')
      textarea.setAttribute('inputmode', 'text')
      textarea.setAttribute('spellcheck', 'false')
      textarea.addEventListener('blur', handleTextareaBlur)
    }

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // 连接 WebSocket（带自动重连）
    let reconnectTimer: number | null = null
    let reconnectAttempt = 0
    const MAX_RECONNECT_DELAY = 30000 // 最大 30s
    const BASE_RECONNECT_DELAY = 1000 // 起始 1s
    let intentionalClose = false // 标记主动关闭
    const useNativePtyBridge = isTauri()

    const resetTransport = () => {
      transportSendRef.current = null
      transportDisconnectRef.current = null
    }

    const handleConnected = () => {
      logger.log(useNativePtyBridge ? '[Terminal/Tauri] Connected:' : '[Terminal] WebSocket connected:', ptyId)
      if (!mountedRef.current) return
      reconnectAttempt = 0
      layoutStore.updateTerminalTab(ptyId, { status: 'connected' })
      const { cols, rows } = terminal
      logger.log('[Terminal] Sending size:', cols, 'x', rows)
      updatePtySession(ptyId, { size: { cols, rows } }, terminalDirectory).catch(() => {})
    }

    const handleDisconnected = ({ code, reason }: { code?: number; reason?: string }) => {
      logger.log(
        useNativePtyBridge ? '[Terminal/Tauri] Disconnected:' : '[Terminal] WebSocket closed:',
        ptyId,
        code,
        reason,
      )
      resetTransport()
      if (!mountedRef.current) return
      layoutStore.updateTerminalTab(ptyId, { status: 'disconnected' })

      if (intentionalClose || code === 1000) {
        terminal.write('\r\n\x1b[90m[Connection closed]\x1b[0m\r\n')
        return
      }

      reconnectAttempt++
      const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempt - 1), MAX_RECONNECT_DELAY)
      terminal.write(`\r\n\x1b[90m[Disconnected, reconnecting in ${(delay / 1000).toFixed(0)}s...]\x1b[0m\r\n`)
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        if (mountedRef.current) {
          connectTransport()
        }
      }, delay)
    }

    const connectTransport = () => {
      if (!mountedRef.current) return

      fitAddon.fit()
      const cursor = cursorRef.current

      if (useNativePtyBridge) {
        logger.log(
          '[Terminal/Tauri] Connecting PTY bridge:',
          ptyId,
          reconnectAttempt > 0 ? `(reconnect #${reconnectAttempt})` : '',
        )
        void import('../api/ptyBridge')
          .then(({ connectTauriPty }) =>
            connectTauriPty({
              ptyId,
              directory: terminalDirectory,
              cursor,
              onConnected: handleConnected,
              onMessage: chunk => {
                if (!mountedRef.current) return
                const frame = parsePtyFrame(chunk)
                if (!frame) return
                if (frame.kind === 'control') {
                  cursorRef.current = frame.cursor
                  return
                }
                terminal.write(frame.data)
                cursorRef.current += frame.data.length
              },
              onDisconnected: handleDisconnected,
              onError: message => {
                logger.log('[Terminal/Tauri] PTY bridge error:', ptyId, message)
              },
            }),
          )
          .then(connection => {
            if (!connection) return
            if (!mountedRef.current) {
              connection.close()
              return
            }
            transportSendRef.current = data => connection.send(data)
            transportDisconnectRef.current = () => connection.close()
          })
          .catch(error => {
            const message = error instanceof Error ? error.message : String(error)
            logger.log('[Terminal/Tauri] Failed to initialize PTY bridge:', ptyId, message)
            handleDisconnected({ reason: message })
          })
      } else {
        const wsUrl = getPtyConnectUrl(ptyId, terminalDirectory, { cursor })
        logger.log('[Terminal] Connecting to:', wsUrl, reconnectAttempt > 0 ? `(reconnect #${reconnectAttempt})` : '')
        ws = new WebSocket(wsUrl)
        ws.binaryType = 'arraybuffer'
        transportSendRef.current = data => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data)
          }
        }
        transportDisconnectRef.current = () => ws?.close()

        ws.onopen = handleConnected

        ws.onmessage = event => {
          if (!mountedRef.current) return
          const frame = parsePtyFrame(event.data as string | ArrayBuffer)
          if (!frame) return
          if (frame.kind === 'control') {
            cursorRef.current = frame.cursor
            return
          }
          terminal.write(frame.data)
          cursorRef.current += frame.data.length
        }

        ws.onclose = e => {
          handleDisconnected({ code: e.code, reason: e.reason })
        }

        ws.onerror = e => {
          logger.log('[Terminal] WebSocket error:', ptyId, e)
          // onclose 会在 onerror 之后触发，重连逻辑交给 onclose
        }
      }

      disposeData?.dispose()
      disposeData = terminal.onData(data => {
        sendTerminalData(data)
      })
    }

    const scheduleInitialConnect = () => {
      wsConnectTimeout = requestAnimationFrame(connectTransport) as unknown as number
    }

    if (restoreBuffer) {
      terminal.write(restoreBuffer, () => {
        if (!mountedRef.current) return
        if (restoreScrollY !== undefined) {
          terminal.scrollToLine(restoreScrollY)
        }
        scheduleInitialConnect()
      })
    } else {
      scheduleInitialConnect()
    }

    disposeTitle = terminal.onTitleChange(title => {
      if (!mountedRef.current) return
      layoutStore.updateTerminalShellTitle(ptyId, title, manualTerminalTitlesRef.current)
    })

    return () => {
      mountedRef.current = false
      intentionalClose = true
      if (wsConnectTimeout) {
        cancelAnimationFrame(wsConnectTimeout)
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
        resizeTimeoutRef.current = null
      }

      try {
        layoutStore.updateTerminalSnapshot(ptyId, {
          buffer: serializeAddon.serialize(),
          scrollY: terminal.buffer.active.viewportY,
          cursor: cursorRef.current,
          rows: terminal.rows,
          cols: terminal.cols,
        })
      } catch {
        // ignore snapshot persistence failures
      }

      transportDisconnectRef.current?.()
      disposeData?.dispose()
      disposeTitle?.dispose()
      textarea?.removeEventListener('blur', handleTextareaBlur)
      terminalElement?.removeEventListener('mouseup', handleSelectionCopy)
      terminalElement?.removeEventListener('contextmenu', handleContextMenuPaste)
      resetTransport()
      // 显式 dispose addons
      fitAddon.dispose()
      serializeAddon.dispose()
      webLinksAddon.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [
    ptyId,
    hasBeenActive,
    clearStickyModifiers,
    sendTerminalData,
    preferTouchUi,
    restoreBuffer,
    restoreScrollY,
    restoreCursor,
    restoreCols,
    restoreRows,
  ])

  useEffect(() => {
    const container = containerRef.current
    const terminal = terminalRef.current
    if (!container || !terminal) return
    if (!touchCapable) return

    let touchStartY = 0
    let scrollStart = 0
    let lastTouchY = 0
    let lastTouchTime = 0
    let velocity = 0
    let momentumRaf = 0

    const stopMomentum = () => {
      if (momentumRaf) {
        cancelAnimationFrame(momentumRaf)
        momentumRaf = 0
      }
    }

    const startMomentum = () => {
      const viewport = terminal.element?.querySelector('.xterm-viewport') as HTMLElement | null
      if (!viewport || Math.abs(velocity) < 0.5) {
        setIsTouchScrolling(false)
        return
      }

      const friction = 0.95
      const step = () => {
        velocity *= friction
        if (Math.abs(velocity) < 0.5) {
          momentumRaf = 0
          // 惯性结束后延迟淡出滚动条
          setTimeout(() => setIsTouchScrolling(false), 600)
          return
        }
        viewport.scrollTop += velocity
        momentumRaf = requestAnimationFrame(step)
      }
      momentumRaf = requestAnimationFrame(step)
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      stopMomentum()
      const y = e.touches[0].clientY
      touchStartY = y
      lastTouchY = y
      lastTouchTime = Date.now()
      velocity = 0
      const viewport = terminal.element?.querySelector('.xterm-viewport') as HTMLElement | null
      scrollStart = viewport?.scrollTop ?? 0
      setIsTouchScrolling(false)
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const viewport = terminal.element?.querySelector('.xterm-viewport') as HTMLElement | null
      if (!viewport) return

      const y = e.touches[0].clientY
      const delta = touchStartY - y

      if (Math.abs(delta) > 6) {
        setIsTouchScrolling(true)
      }

      // 计算速度（用于惯性）
      const now = Date.now()
      const dt = now - lastTouchTime
      if (dt > 0) {
        velocity = ((lastTouchY - y) / dt) * 16 // 归一化到每帧 px
      }
      lastTouchY = y
      lastTouchTime = now

      viewport.scrollTop = scrollStart + delta
      if (touchCapable) {
        e.preventDefault()
      }
    }

    const handleTouchEnd = () => {
      startMomentum()
    }

    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd)

    return () => {
      stopMomentum()
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isActive, touchCapable])

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
          updatePtySession(ptyId, { size: { cols, rows } }, terminalDirectoryRef.current).catch(() => {})
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
        resizeTimeoutRef.current = null
      }
    }
  }, [isActive, ptyId])

  // 主题变化时更新
  useEffect(() => {
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-mode') {
          if (terminalRef.current) {
            terminalRef.current.options.theme = getTerminalTheme(isDarkMode())
          }
          break
        }
      }
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode'],
    })

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

  useEffect(() => {
    if (!isActive) {
      clearStickyModifiers()
    }
  }, [isActive, clearStickyModifiers])

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
          updatePtySession(ptyId, { size: { cols, rows } }, terminalDirectoryRef.current).catch(() => {})
        })
      }
    }

    window.addEventListener('panel-resize-end', handlePanelResizeEnd)
    return () => window.removeEventListener('panel-resize-end', handlePanelResizeEnd)
  }, [isActive, ptyId])

  return (
    <>
      <style>{`
        .xterm-viewport, 
        .xterm-screen, 
        .xterm-scrollable-element {
          background-color: transparent !important;
        }
        .xterm {
          padding: 0 !important;
        }
        /* 滚动条基础样式 */
        .xterm-viewport {
          scrollbar-width: thin;
          scrollbar-color: hsl(var(--border-300) / 0.25) transparent;
        }
        .xterm-viewport::-webkit-scrollbar {
          width: 6px;
          background: transparent;
        }
        .xterm-viewport::-webkit-scrollbar-track {
          background: transparent;
        }
        .xterm-viewport::-webkit-scrollbar-thumb {
          background-color: hsl(var(--border-300) / 0.25);
          border-radius: 99px;
          transition: background-color 0.2s ease;
        }
        .xterm-viewport::-webkit-scrollbar-thumb:hover {
          background-color: hsl(var(--border-300) / 0.5);
        }
        /* 移动端：空闲时滚动条淡出，滚动时显示 */
        .scrollbar-idle .xterm-viewport::-webkit-scrollbar-thumb {
          background-color: hsl(var(--border-300) / 0);
          transition: background-color 0.8s ease;
        }
        .scrollbar-active .xterm-viewport::-webkit-scrollbar-thumb {
          background-color: hsl(var(--border-300) / 0.35);
          transition: background-color 0.15s ease;
        }
      `}</style>
      <div
        className={`${preferTouchUi ? 'flex flex-col' : ''} h-full w-full`}
        style={{
          visibility: isActive ? 'visible' : 'hidden',
          position: isActive ? 'relative' : 'absolute',
          pointerEvents: isActive ? 'auto' : 'none',
          inset: isActive ? undefined : 0,
        }}
      >
        <div
          ref={containerRef}
          className={`${preferTouchUi ? 'flex-1 min-h-0' : 'h-full'} w-full bg-bg-100 ${preferTouchUi ? 'no-scrollbar' : ''} ${preferTouchUi ? (isTouchScrolling ? 'scrollbar-active' : 'scrollbar-idle') : ''}`}
          style={{
            padding: preferTouchUi ? '0' : '4px 0 0 4px',
            touchAction: touchCapable ? 'pan-y' : 'auto',
          }}
          onClick={() => {
            if (preferTouchUi && terminalRef.current) {
              focusTerminal()
            }
          }}
          onTouchEnd={e => {
            if (terminalRef.current && e.target === containerRef.current) {
              focusTerminal()
            }
          }}
        />
        {preferTouchUi && (
          <MobileExtraKeys
            stickyModifiers={stickyModifiers}
            onToggleSticky={toggleStickyModifier}
            onSend={sendTerminalData}
            onFocusTerminal={focusTerminal}
          />
        )}
      </div>
    </>
  )
})
