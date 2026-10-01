// 打印指定 v2 事件类型的完整声明（含 data 形状）。
// 用法: node scripts/v2-event-shape.mjs server.connected session.deleted
import { readFileSync } from 'node:fs'

const source = readFileSync('node_modules/@opencode/client/dist/promise/generated/types.d.ts', 'utf8')

for (const name of process.argv.slice(2)) {
  const needle = `type: "${name}";`
  const at = source.indexOf(needle)
  if (at === -1) {
    console.log(`=== ${name}: NOT FOUND`)
    continue
  }
  // 向前找所属 export type
  const before = source.slice(0, at)
  const match = [...before.matchAll(/export type (\w+) = \{/g)].pop()
  const start = match ? match.index : at
  const end = source.indexOf('\n};', at)
  console.log(`=== ${name}  (${match ? match[1] : '?'})`)
  console.log(source.slice(start, end + 3).replace(/\n\s+/g, ' '))
  console.log()
}
