// 列出 OpenCode v2 的全部事件名，按前缀分组。
// 用法: node scripts/v2-events.mjs [前缀过滤]
import { readFileSync } from 'node:fs'

const file = 'node_modules/@opencode/client/dist/promise/generated/types.d.ts'
const source = readFileSync(file, 'utf8')

const names = new Set()
for (const m of source.matchAll(/type:\s*"([a-z][a-z0-9._]+)"/g)) {
  names.add(m[1])
}

const filter = process.argv[2]
const list = [...names].filter(n => !filter || n.includes(filter)).sort()

const groups = new Map()
for (const name of list) {
  const prefix = name.includes('.') ? name.slice(0, name.indexOf('.')) : name
  if (!groups.has(prefix)) groups.set(prefix, [])
  groups.get(prefix).push(name)
}

console.log(`共 ${list.length} 个事件（过滤: ${filter ?? '无'}）\n`)
for (const [prefix, items] of [...groups].sort()) {
  console.log(`[${prefix}] ${items.length}`)
  for (const item of items) console.log(`  ${item}`)
}
