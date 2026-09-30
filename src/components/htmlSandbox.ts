export type HtmlColorScheme = 'light' | 'dark'

export const HTML_SANDBOX_SECURITY_HEAD = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; img-src https: http: data: blob:; media-src https: http: data: blob:; font-src https: http: data:; style-src 'unsafe-inline' https: http:; script-src 'unsafe-inline' 'unsafe-eval' https: http: blob:; connect-src https: http:">`
export const HTML_SANDBOX_VIEWPORT_HEAD = '<meta name="viewport" content="width=device-width, initial-scale=1">'
export const HTML_SANDBOX_EDGE_OVERFLOW_TOLERANCE = 2
const HTML_SANDBOX_THEME_VARIABLES = {
  light: {
    '--surface-0': '#ffffff',
    '--surface-1': '#f5f4f1',
    '--surface-2': '#ffffff',
    '--text-primary': '#0b0b0b',
    '--text-secondary': '#52514e',
    '--text-muted': '#898781',
    '--border': '#e3e1da',
    '--border-strong': '#cfccc2',
    '--text-accent': '#185fa5',
    '--bg-accent': '#e6f1fb',
    '--bg-success': '#eaf3de',
    '--text-success': '#27500a',
    '--radius': '8px',
  },
  dark: {
    '--surface-0': '#161614',
    '--surface-1': '#2a2a28',
    '--surface-2': '#1f1f1d',
    '--text-primary': '#ffffff',
    '--text-secondary': '#c3c2b7',
    '--text-muted': '#898781',
    '--border': '#3a3a37',
    '--border-strong': '#52514e',
    '--text-accent': '#85b7eb',
    '--bg-accent': '#042c53',
    '--bg-success': '#173404',
    '--text-success': '#97c459',
    '--radius': '8px',
  },
} as const

export function normalizeHtmlSandboxContentWidth(measuredWidth: number, viewportWidth: number): number {
  const measured = Math.max(1, Math.ceil(measuredWidth))
  const viewport = Math.max(1, Math.ceil(viewportWidth))
  return measured <= viewport + HTML_SANDBOX_EDGE_OVERFLOW_TOLERANCE ? viewport : measured
}

export function createHtmlSandboxStorageScript(): string {
  return `<script>(()=>{const create=()=>{const values=new Map();return{get length(){return values.size},key:index=>Array.from(values.keys())[Number(index)]??null,getItem:key=>values.get(String(key))??null,setItem:(key,value)=>{key=String(key);value=String(value);let size=key.length+value.length;for(const [storedKey,storedValue] of values){if(storedKey!==key)size+=storedKey.length+storedValue.length}if(size>1048576)throw new DOMException('Storage quota exceeded','QuotaExceededError');values.set(key,value)},removeItem:key=>{values.delete(String(key))},clear:()=>values.clear()}};for(const name of['localStorage','sessionStorage']){try{window[name].getItem('__opencode_probe__');continue}catch{}try{Object.defineProperty(window,name,{configurable:true,enumerable:true,value:create()})}catch{}}})()</script>`
}

function sandboxThemeVariablesCss(theme: HtmlColorScheme): string {
  return Object.entries(HTML_SANDBOX_THEME_VARIABLES[theme])
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
}

function scrollbarCss(theme: HtmlColorScheme): string {
  const thumb = theme === 'dark' ? 'rgba(210,210,210,.35)' : 'rgba(100,100,100,.35)'
  const thumbHover = theme === 'dark' ? 'rgba(210,210,210,.6)' : 'rgba(100,100,100,.6)'
  return `*{scrollbar-width:thin;scrollbar-color:${thumb} transparent}*::-webkit-scrollbar{width:12px;height:12px;background:transparent}*::-webkit-scrollbar-button{display:none;width:0;height:0}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background-color:${thumb};background-clip:content-box;border:4px solid transparent;border-radius:9999px}*::-webkit-scrollbar-thumb:hover{background-color:${thumbHover}}`
}

export function buildHtmlSandboxThemeCss(theme: HtmlColorScheme, overflow: 'auto' | 'hidden' = 'hidden'): string {
  const textColor = theme === 'dark' ? '#d8d8d8' : '#2b2b2b'
  const root = `:root{color-scheme:${theme};font-family:system-ui,sans-serif;${sandboxThemeVariablesCss(theme)}}`
  if (overflow === 'auto') {
    // File preview: pin the document to the iframe viewport so body is the scrollport.
    return `${root}html{height:100%;width:100%;margin:0;overflow:hidden}body{height:100%;width:100%;margin:0;overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;overscroll-behavior:contain;background:transparent;color:${textColor}}${scrollbarCss(theme)}`
  }
  // Message-stream preview: no internal scroll; parent document scrolls like CM6 tool results.
  return `${root}html,body{margin:0;overflow:hidden;background:transparent;color:${textColor}}`
}

/**
 * Shared content-size probe for sandbox previews.
 * Walks visible rendered boxes instead of documentElement scroll metrics so
 * auto-sized hosts can shrink after the iframe has already grown.
 */
export function createHtmlSandboxMeasureScript(resizeId: string): string {
  return `<script>(()=>{const id=${JSON.stringify(resizeId)};const send=()=>{const body=document.body;if(!body)return;const root=body.getBoundingClientRect();let bottom=0;let right=0;const nodes=body.querySelectorAll('*');for(let i=0;i<nodes.length;i+=1){const el=nodes[i];const tag=el.tagName;if(tag==='SCRIPT'||tag==='STYLE'||tag==='LINK'||tag==='META')continue;const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden'||style.position==='fixed')continue;const rect=el.getBoundingClientRect();bottom=Math.max(bottom,rect.bottom-root.top);right=Math.max(right,rect.right-root.left)}const height=Math.max(120,Math.ceil(bottom||body.scrollHeight));const viewportWidth=Math.max(1,Math.ceil(root.width));const measuredWidth=Math.max(1,Math.ceil(right||body.scrollWidth));const width=measuredWidth<=viewportWidth+${HTML_SANDBOX_EDGE_OVERFLOW_TOLERANCE}?viewportWidth:measuredWidth;parent.postMessage({type:'opencode-html-resize',id,height,width},'*')};addEventListener('pointerdown',()=>parent.postMessage({type:'opencode-html-interaction',id},'*'),true);addEventListener('opencode-html-measure',send);addEventListener('load',send);if(typeof ResizeObserver!=='undefined')new ResizeObserver(send).observe(document.body);requestAnimationFrame(send)})()</script>`
}

function createThemeApplyScript(overflow: 'auto' | 'hidden'): string {
  // Keep the runtime theme builder aligned with buildHtmlSandboxThemeCss().
  return `<script>(()=>{const overflow=${JSON.stringify(overflow)};const themes=${JSON.stringify(HTML_SANDBOX_THEME_VARIABLES)};const buildCss=theme=>{const textColor=theme==='dark'?'#d8d8d8':'#2b2b2b';const vars=Object.entries(themes[theme]).map(([name,value])=>name+':'+value).join(';');const root=':root{color-scheme:'+theme+';font-family:system-ui,sans-serif;'+vars+'}';if(overflow==='auto'){const thumb=theme==='dark'?'rgba(210,210,210,.35)':'rgba(100,100,100,.35)';const thumbHover=theme==='dark'?'rgba(210,210,210,.6)':'rgba(100,100,100,.6)';const scrollbar='*{scrollbar-width:thin;scrollbar-color:'+thumb+' transparent}*::-webkit-scrollbar{width:12px;height:12px;background:transparent}*::-webkit-scrollbar-button{display:none;width:0;height:0}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background-color:'+thumb+';background-clip:content-box;border:4px solid transparent;border-radius:9999px}*::-webkit-scrollbar-thumb:hover{background-color:'+thumbHover+'}';return root+'html{height:100%;width:100%;margin:0;overflow:hidden}body{height:100%;width:100%;margin:0;overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;overscroll-behavior:contain;background:transparent;color:'+textColor+'}'+scrollbar}return root+'html,body{margin:0;overflow:hidden;background:transparent;color:'+textColor+'}'};const apply=theme=>{document.documentElement.style.colorScheme=theme;document.documentElement.dataset.theme=theme;const style=document.getElementById('opencode-html-theme');if(style)style.textContent=buildCss(theme);dispatchEvent(new CustomEvent('opencode-theme-change',{detail:{theme}}));dispatchEvent(new Event('resize'))};addEventListener('message',event=>{if(event.data?.type==='opencode-html-theme')apply(event.data.theme)})})()</script>`
}

export function createSandboxedHtmlDocument(
  source: string,
  resizeId: string,
  theme: HtmlColorScheme,
  options: { overflow?: 'auto' | 'hidden'; allowDataScripts?: boolean } = {},
): string {
  const overflow = options.overflow ?? 'hidden'
  const securityHead = options.allowDataScripts
    ? HTML_SANDBOX_SECURITY_HEAD.replace('http: blob:', 'http: blob: data:')
    : HTML_SANDBOX_SECURITY_HEAD
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  const viewportHead = parsed.head.querySelector('meta[name="viewport"]') ? '' : HTML_SANDBOX_VIEWPORT_HEAD
  const themeHead = `<style id="opencode-html-theme">${buildHtmlSandboxThemeCss(theme, overflow)}</style>`
  parsed.head.insertAdjacentHTML(
    'afterbegin',
    `${securityHead}${viewportHead}${themeHead}${createHtmlSandboxStorageScript()}`,
  )
  parsed.body.insertAdjacentHTML(
    'afterbegin',
    `${createThemeApplyScript(overflow)}${createHtmlSandboxMeasureScript(resizeId)}`,
  )
  return `<!doctype html>${parsed.documentElement.outerHTML}`
}
