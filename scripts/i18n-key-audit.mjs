// 检查 t('key') 引用的键是否真的存在于 locale 文件里。
// 缺失的键不会报错、不会崩：
//   - 带 defaultValue 的会在中文界面显示英文
//   - 不带的会显示成原始 key 文本（例如 "chat:retryStatus.retrying"）
// 两者都属于静默失效。
//
// 命名空间判定：单文件里可能有多个 useTranslation()（不同子组件用不同 ns），
// 静态无法可靠归属。因此只要该键**存在于任意命名空间**就不报——宁可漏报，
// 也不要产生需要人工逐个核对的假阳性（第一版就误报了两个 components 的键）。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    const f = join(d, n)
    statSync(f).isDirectory() ? walk(f, out) : out.push(f)
  }
  return out
}

const srcFiles = walk('src').filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
const namespaces = readdirSync('src/locales/zh-CN')
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace(/\.json$/, ''))

const dicts = {}
for (const ns of namespaces) {
  dicts[ns] = JSON.parse(readFileSync(`src/locales/zh-CN/${ns}.json`, 'utf8'))
}

function lookupIn(ns, path) {
  let cur = dicts[ns]
  if (!cur) return false
  for (const p of path.split('.')) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return false
    cur = cur[p]
  }
  return true
}

/** 该键在任意命名空间存在即算命中（避免 ns 归属误判） */
function existsAnywhere(path) {
  // i18next 的复数：带 { count } 调用时会查 `key_one` / `key_other`，
  // 因此这些后缀也算命中（第一版没处理，误报了 3 个复数键）。
  const candidates = [path, `${path}_one`, `${path}_other`, `${path}_zero`]
  return namespaces.some(ns => candidates.some(c => lookupIn(ns, c)))
}

const missing = []
const seen = new Set()
for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/\bt\(\s*'([^']+)'/g)) {
    const key = m[1]
    let path = key
    if (key.includes(':')) path = key.slice(key.indexOf(':') + 1)
    if (path.includes('${')) continue
    if (seen.has(path)) continue
    seen.add(path)
    if (!existsAnywhere(path)) missing.push({ id: key, file: file.replace(/\\/g, '/') })
  }
}

console.log(`检查了 ${seen.size} 个唯一键引用`)
console.log(`\n== 引用了但任何命名空间里都不存在 (${missing.length}) ==`)
for (const m of missing.sort((a, b) => a.id.localeCompare(b.id))) console.log(`  ${m.id}   (${m.file})`)
