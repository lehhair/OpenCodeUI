import { getFileContent } from '../api/file'
import type { FileContent } from '../api/types'
import { buildDataUrl, buildTextDataUrl, decodeBase64Text, isBinaryContent } from '../utils/mimeUtils'

const ABSOLUTE_RESOURCE_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i

function stripResourceSuffix(value: string): string {
  const suffixIndex = value.search(/[?#]/)
  return suffixIndex === -1 ? value : value.slice(0, suffixIndex)
}

function normalizeHtmlPath(htmlPath: string, directory?: string): string | null {
  const normalizedHtmlPath = htmlPath.replace(/\\/g, '/')
  if (!/^(?:[A-Za-z]:\/|\/)/.test(normalizedHtmlPath)) return normalizedHtmlPath.replace(/^\.\//, '')
  if (!directory) return null

  const normalizedDirectory = directory.replace(/\\/g, '/').replace(/\/+$/, '')
  const caseInsensitive = /^[A-Za-z]:\//.test(normalizedDirectory)
  const comparablePath = caseInsensitive ? normalizedHtmlPath.toLowerCase() : normalizedHtmlPath
  const comparableDirectory = caseInsensitive ? normalizedDirectory.toLowerCase() : normalizedDirectory
  if (comparablePath !== comparableDirectory && !comparablePath.startsWith(`${comparableDirectory}/`)) return null
  return normalizedHtmlPath.slice(normalizedDirectory.length).replace(/^\/+/, '')
}

export function resolveHtmlResourcePath(htmlPath: string, reference: string, directory?: string): string | null {
  const trimmed = reference.trim()
  if (!trimmed || ABSOLUTE_RESOURCE_PATTERN.test(trimmed)) return null

  let decoded: string
  try {
    decoded = decodeURIComponent(stripResourceSuffix(trimmed))
  } catch {
    decoded = stripResourceSuffix(trimmed)
  }
  if (!decoded) return null

  const normalizedHtmlPath = normalizeHtmlPath(htmlPath, directory)
  if (!normalizedHtmlPath) return null
  const normalizedReference = decoded.replace(/\\/g, '/')
  const baseParts = normalizedReference.startsWith('/') ? [] : normalizedHtmlPath.split('/').slice(0, -1)
  const referenceParts = normalizedReference.replace(/^\/+/, '').split('/')
  const parts = [...baseParts]

  for (const part of referenceParts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }

  return parts.join('/')
}

function fallbackMimeType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  const types: Record<string, string> = {
    css: 'text/css',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'text/javascript',
    json: 'application/json',
    mjs: 'text/javascript',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    png: 'image/png',
    svg: 'image/svg+xml',
    webm: 'video/webm',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
  }
  return (extension && types[extension]) || 'application/octet-stream'
}

function fileContentToText(content: FileContent): string {
  return isBinaryContent(content.encoding) ? decodeBase64Text(content.content) : content.content
}

function fileContentToDataUrl(content: FileContent, path: string): string {
  const mimeType = content.mimeType || fallbackMimeType(path)
  return isBinaryContent(content.encoding)
    ? buildDataUrl(mimeType, content.content)
    : buildTextDataUrl(mimeType, content.content)
}

type ResourceKind = 'media' | 'script' | 'style'

function isPotentiallyAllowedPath(path: string, kind: ResourceKind): boolean {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  if (kind === 'script') return ['js', 'mjs', 'cjs'].includes(extension)
  if (kind === 'style') return extension === 'css'
  return [
    'avif',
    'gif',
    'jpeg',
    'jpg',
    'mp3',
    'mp4',
    'ogg',
    'otf',
    'png',
    'svg',
    'ttf',
    'wav',
    'webm',
    'webp',
    'woff',
    'woff2',
  ].includes(extension)
}

function isAllowedResource(content: FileContent, path: string, kind: ResourceKind): boolean {
  const mimeType = (content.mimeType || fallbackMimeType(path)).split(';', 1)[0].toLowerCase()
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  if (kind === 'script') {
    return ['js', 'mjs', 'cjs'].includes(extension) || ['application/javascript', 'text/javascript'].includes(mimeType)
  }
  if (kind === 'style') return extension === 'css' || mimeType === 'text/css'
  return /^(?:image|audio|video|font)\//.test(mimeType) || ['woff', 'woff2', 'ttf', 'otf'].includes(extension)
}

function hasUnresolvedModuleImports(source: string): boolean {
  const pattern = /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?|\bimport\s*\()\s*['"]([^'"]+)['"]/g
  return Array.from(source.matchAll(pattern)).some(match => !ABSOLUTE_RESOURCE_PATTERN.test(match[1]))
}

async function replaceCssUrls(
  css: string,
  cssPath: string,
  directory: string | undefined,
  load: (path: string, kind: ResourceKind) => Promise<FileContent | null>,
): Promise<string> {
  const pattern = /url\(\s*(?:(['"])(.*?)\1|([^)]*?))\s*\)/gi
  const matches = Array.from(css.matchAll(pattern))
  if (!matches.length) return css

  const replacements = await Promise.all(
    matches.map(async match => {
      const reference = (match[2] ?? match[3] ?? '').trim()
      const path = resolveHtmlResourcePath(cssPath, reference, directory)
      if (!path) return match[0]
      const content = await load(path, 'media')
      return content ? `url("${fileContentToDataUrl(content, path)}")` : match[0]
    }),
  )

  let result = ''
  let cursor = 0
  matches.forEach((match, index) => {
    const start = match.index ?? cursor
    result += css.slice(cursor, start) + replacements[index]
    cursor = start + match[0].length
  })
  return result + css.slice(cursor)
}

async function replaceSrcset(
  srcset: string,
  htmlPath: string,
  directory: string | undefined,
  load: (path: string, kind: ResourceKind) => Promise<FileContent | null>,
): Promise<string> {
  const candidates = srcset.split(',')
  return (
    await Promise.all(
      candidates.map(async candidate => {
        const trimmed = candidate.trim()
        const separator = trimmed.search(/\s/)
        const reference = separator === -1 ? trimmed : trimmed.slice(0, separator)
        const descriptor = separator === -1 ? '' : trimmed.slice(separator)
        const path = resolveHtmlResourcePath(htmlPath, reference, directory)
        if (!path) return candidate
        const content = await load(path, 'media')
        return content ? `${fileContentToDataUrl(content, path)}${descriptor}` : candidate
      }),
    )
  ).join(',')
}

export async function resolveHtmlPreviewResources(html: string, htmlPath: string, directory?: string): Promise<string> {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const requests = new Map<string, Promise<FileContent | null>>()
  const loadRaw = (path: string) => {
    const cached = requests.get(path)
    if (cached) return cached
    const request = getFileContent(path, directory).catch(() => null)
    requests.set(path, request)
    return request
  }
  const load = async (path: string, kind: ResourceKind) => {
    if (!isPotentiallyAllowedPath(path, kind)) return null
    const content = await loadRaw(path)
    return content && isAllowedResource(content, path, kind) ? content : null
  }

  parsed.querySelectorAll('base').forEach(base => base.remove())

  await Promise.all(
    Array.from(parsed.querySelectorAll<HTMLScriptElement>('script[src]')).map(async script => {
      const path = resolveHtmlResourcePath(htmlPath, script.getAttribute('src') ?? '', directory)
      if (!path) return
      const content = await load(path, 'script')
      if (!content) return
      const source = fileContentToText(content)
      const isModule = script.getAttribute('type')?.trim().toLowerCase() === 'module'
      if (isModule && hasUnresolvedModuleImports(source)) {
        script.removeAttribute('src')
        script.setAttribute('type', 'application/x-opencode-unresolved-module')
        script.setAttribute('data-opencode-unresolved-src', path)
        script.textContent = source.replace(/<\/script/gi, '<\\/script')
        return
      }
      script.setAttribute('src', fileContentToDataUrl(content, path))
      script.removeAttribute('integrity')
      script.removeAttribute('crossorigin')
      script.textContent = ''
    }),
  )

  await Promise.all(
    Array.from(parsed.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')).map(async link => {
      const path = resolveHtmlResourcePath(htmlPath, link.getAttribute('href') ?? '', directory)
      if (!path) return
      const content = await load(path, 'style')
      if (!content) return
      const style = parsed.createElement('style')
      style.setAttribute('data-opencode-resolved-css', '')
      if (link.media) style.media = link.media
      style.textContent = (await replaceCssUrls(fileContentToText(content), path, directory, load)).replace(
        /<\/style/gi,
        '<\\/style',
      )
      link.replaceWith(style)
    }),
  )

  await Promise.all(
    Array.from(parsed.querySelectorAll<HTMLStyleElement>('style:not([data-opencode-resolved-css])')).map(
      async style => {
        style.textContent = await replaceCssUrls(style.textContent ?? '', htmlPath, directory, load)
      },
    ),
  )

  const mediaAttributes: Array<[string, string]> = [
    ['img[src]', 'src'],
    ['input[type="image"][src]', 'src'],
    ['audio[src]', 'src'],
    ['video[src]', 'src'],
    ['video[poster]', 'poster'],
    ['source[src]', 'src'],
    ['link[rel~="icon"][href]', 'href'],
  ]
  await Promise.all(
    mediaAttributes.flatMap(([selector, attribute]) =>
      Array.from(parsed.querySelectorAll<HTMLElement>(selector)).map(async element => {
        const path = resolveHtmlResourcePath(htmlPath, element.getAttribute(attribute) ?? '', directory)
        if (!path) return
        const content = await load(path, 'media')
        if (content) element.setAttribute(attribute, fileContentToDataUrl(content, path))
      }),
    ),
  )

  await Promise.all(
    Array.from(parsed.querySelectorAll<HTMLElement>('[style]')).map(async element => {
      const style = element.getAttribute('style')
      if (style) element.setAttribute('style', await replaceCssUrls(style, htmlPath, directory, load))
    }),
  )

  await Promise.all(
    Array.from(parsed.querySelectorAll<HTMLElement>('[srcset]')).map(async element => {
      const srcset = element.getAttribute('srcset')
      if (srcset) element.setAttribute('srcset', await replaceSrcset(srcset, htmlPath, directory, load))
    }),
  )

  return `<!doctype html>${parsed.documentElement.outerHTML}`
}
