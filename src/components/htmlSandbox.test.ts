import { describe, expect, it } from 'vitest'
import {
  buildHtmlSandboxThemeCss,
  createHtmlSandboxMeasureScript,
  createHtmlSandboxStorageScript,
  createSandboxedHtmlDocument,
  HTML_SANDBOX_EDGE_OVERFLOW_TOLERANCE,
  normalizeHtmlSandboxContentWidth,
} from './htmlSandbox'

describe('HTML sandbox measurement', () => {
  it('ignores tiny edge overflow from responsive content borders and rounding', () => {
    expect(normalizeHtmlSandboxContentWidth(601, 600)).toBe(600)
    expect(normalizeHtmlSandboxContentWidth(602, 600)).toBe(600)
  })

  it('preserves real horizontal overflow', () => {
    expect(normalizeHtmlSandboxContentWidth(1200, 600)).toBe(1200)
    expect(normalizeHtmlSandboxContentWidth(600 + HTML_SANDBOX_EDGE_OVERFLOW_TOLERANCE + 1, 600)).toBe(603)
  })

  it('applies the same edge tolerance inside the iframe measurement bridge', () => {
    const script = createHtmlSandboxMeasureScript('preview')

    expect(script).toContain(`measuredWidth<=viewportWidth+${HTML_SANDBOX_EDGE_OVERFLOW_TOLERANCE}`)
  })
})

describe('HTML sandbox theme', () => {
  it('provides light theme variables for standalone artifacts', () => {
    const css = buildHtmlSandboxThemeCss('light')

    expect(css).toContain('--surface-1:#f5f4f1')
    expect(css).toContain('--text-primary:#0b0b0b')
    expect(css).toContain('--border-strong:#cfccc2')
  })

  it('provides dark theme variables for standalone artifacts', () => {
    const css = buildHtmlSandboxThemeCss('dark')

    expect(css).toContain('--surface-1:#2a2a28')
    expect(css).toContain('--text-primary:#ffffff')
    expect(css).toContain('--border-strong:#52514e')
  })
})

describe('HTML sandbox storage', () => {
  function installFallbackStorage() {
    const source = createHtmlSandboxStorageScript().replace(/^<script>|<\/script>$/g, '')
    const sandboxWindow = {} as Window & typeof globalThis
    Object.defineProperty(sandboxWindow, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('opaque origin', 'SecurityError')
      },
    })
    Object.defineProperty(sandboxWindow, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('opaque origin', 'SecurityError')
      },
    })
    Function('window', 'DOMException', source)(sandboxWindow, DOMException)
    return sandboxWindow
  }

  it('installs isolated synchronous storage APIs when native access is denied', () => {
    const first = installFallbackStorage()
    const second = installFallbackStorage()

    first.localStorage.setItem('score', 12 as unknown as string)
    first.sessionStorage.setItem('screen', 'game')
    expect(first.localStorage.getItem('score')).toBe('12')
    expect(first.localStorage.key(0)).toBe('score')
    expect(first.localStorage.length).toBe(1)
    expect(first.sessionStorage.getItem('screen')).toBe('game')
    expect(second.localStorage.getItem('score')).toBeNull()

    expect(first.localStorage.removeItem('score')).toBeUndefined()
    first.sessionStorage.clear()
    expect(first.localStorage.length).toBe(0)
    expect(first.sessionStorage.length).toBe(0)
  })

  it('injects the storage fallback before user head scripts', () => {
    const document = createSandboxedHtmlDocument(
      '<script>localStorage.setItem("ready", "true")</script><main>preview</main>',
      'preview',
      'light',
    )

    expect(document.indexOf("for(const name of['localStorage','sessionStorage'])")).toBeLessThan(
      document.indexOf('localStorage.setItem("ready", "true")'),
    )
  })
})
