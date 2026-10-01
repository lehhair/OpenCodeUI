import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileContent } from '../api/types'
import { resolveHtmlPreviewResources, resolveHtmlResourcePath } from './htmlPreviewResources'

const getFileContent = vi.hoisted(() => vi.fn())

vi.mock('../api/file', () => ({ getFileContent }))

// ============================================
// v2 的 file.read 返回原始字节：FileContent 只有
// { path, content, isBinary, size, bytes }，没有 v1 的 mimeType / base64 encoding。
// MIME 由路径推断，因此这里的夹具改为字节形态。
// ============================================

function textFile(path: string, content: string): FileContent {
  return { path, content, isBinary: false, size: content.length, bytes: new TextEncoder().encode(content) }
}

function bytesFile(path: string, base64: string): FileContent {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return { path, content: '', isBinary: true, size: bytes.length, bytes }
}

describe('htmlPreviewResources', () => {
  beforeEach(() => {
    getFileContent.mockReset()
  })

  it('resolves workspace-relative paths against the HTML file', () => {
    expect(resolveHtmlResourcePath('pages/demo/index.html', '../assets/app.js?v=1')).toBe('pages/assets/app.js')
    expect(resolveHtmlResourcePath('pages/demo/index.html', '/shared/logo.svg')).toBe('shared/logo.svg')
    expect(resolveHtmlResourcePath('C:\\repo\\pages\\index.html', './app.js', 'C:\\repo')).toBe('pages/app.js')
    expect(resolveHtmlResourcePath('C:\\outside\\index.html', './app.js', 'C:\\repo')).toBeNull()
    expect(resolveHtmlResourcePath('pages/index.html', '../../.env', 'C:\\repo')).toBeNull()
    expect(resolveHtmlResourcePath('pages/index.html', 'https://example.com/app.js')).toBeNull()
    expect(resolveHtmlResourcePath('pages/index.html', 'data:image/png;base64,abc')).toBeNull()
  })

  it('inlines relative scripts, styles, CSS assets, and media', async () => {
    const files = new Map<string, FileContent>([
      ['pages/app.js', textFile('pages/app.js', 'window.previewReady = true')],
      ['pages/styles/main.css', textFile('pages/styles/main.css', '.hero{background:url("../img/bg.png")}')],
      ['pages/img/bg.png', bytesFile('pages/img/bg.png', 'iVBORw==')],
      ['assets/logo.svg', textFile('assets/logo.svg', '<svg><circle r="4"/></svg>')],
    ])
    getFileContent.mockImplementation(async (path: string) => {
      const content = files.get(path)
      if (!content) throw new Error(`missing ${path}`)
      return content
    })

    const html = await resolveHtmlPreviewResources(
      '<link rel="stylesheet" href="./styles/main.css"><main class="hero"><img src="../assets/logo.svg"></main><script src="./app.js"></script>',
      'pages/index.html',
      'C:/workspace',
    )
    const parsed = new DOMParser().parseFromString(html, 'text/html')

    expect(getFileContent).toHaveBeenCalledWith('pages/app.js', 'C:/workspace')
    expect(parsed.querySelector('link[rel="stylesheet"]')).toBeNull()
    expect(parsed.querySelector('style')?.textContent).toContain('data:image/png;base64,iVBORw==')
    expect(parsed.querySelector('script')?.getAttribute('src')).toMatch(/^data:text\/javascript/)
    expect(parsed.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
  })

  it('leaves a missing relative resource in place without failing the preview', async () => {
    getFileContent.mockRejectedValue(new Error('missing'))

    const html = await resolveHtmlPreviewResources('<img src="./missing.png"><p>Still visible</p>', 'index.html')
    const parsed = new DOMParser().parseFromString(html, 'text/html')

    expect(parsed.querySelector('img')?.getAttribute('src')).toBe('./missing.png')
    expect(parsed.body.textContent).toContain('Still visible')
  })

  it('rejects sensitive files before calling the file API', async () => {
    const html = await resolveHtmlPreviewResources(
      '<img src="../.env"><script src="../secrets.json"></script><p>Safe</p>',
      'pages/index.html',
      'C:/workspace',
    )

    expect(getFileContent).not.toHaveBeenCalled()
    expect(html).toContain('../.env')
    expect(html).toContain('../secrets.json')
  })

  it('preserves classic timing and leaves modules with relative imports external', async () => {
    const files = new Map([
      ['pages/defer.js', 'window.deferReady=true'],
      ['pages/async.js', 'window.asyncReady=true'],
      ['pages/module.js', 'import "./chunk.js"; window.moduleReady=true'],
    ])
    getFileContent.mockImplementation(async (path: string) => textFile(path, files.get(path) ?? ''))

    const html = await resolveHtmlPreviewResources(
      '<script defer src="./defer.js"></script><script async src="./async.js"></script><script type="module" src="./module.js"></script>',
      'pages/index.html',
    )
    const scripts = Array.from(new DOMParser().parseFromString(html, 'text/html').scripts)

    expect(scripts[0].getAttribute('src')).toMatch(/^data:text\/javascript/)
    expect(scripts[0].hasAttribute('defer')).toBe(true)
    expect(scripts[1].getAttribute('src')).toMatch(/^data:text\/javascript/)
    expect(scripts[1].hasAttribute('async')).toBe(true)
    expect(scripts[2].hasAttribute('src')).toBe(false)
    expect(scripts[2].getAttribute('type')).toBe('application/x-opencode-unresolved-module')
    expect(scripts[2].getAttribute('data-opencode-unresolved-src')).toBe('pages/module.js')
  })

  it('does not resolve an external stylesheet a second time against the HTML directory', async () => {
    getFileContent.mockImplementation(async (path: string) => {
      if (path === 'pages/styles/main.css') return textFile(path, '.x{background:url("./missing.png")}')
      if (path === 'pages/missing.png') return bytesFile(path, 'iVBORw==')
      throw new Error('missing')
    })

    const html = await resolveHtmlPreviewResources('<link rel="stylesheet" href="./styles/main.css">', 'pages/index.html')

    expect(html).toContain('./missing.png')
    expect(html).not.toContain('data:image/png')
    expect(getFileContent).not.toHaveBeenCalledWith('pages/missing.png', undefined)
  })

  it('resolves inline CSS assets for an absolute HTML path within the project', async () => {
    getFileContent.mockImplementation(async (path: string) => bytesFile(path, 'iVBORw=='))

    const html = await resolveHtmlPreviewResources(
      '<style>.logo{background:url("./img/logo.png")}</style>',
      'C:/repo/pages/index.html',
      'C:/repo',
    )

    expect(getFileContent).toHaveBeenCalledWith('pages/img/logo.png', 'C:/repo')
    expect(html).toContain('data:image/png;base64,iVBORw==')
  })
})
