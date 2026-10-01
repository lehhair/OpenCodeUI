// 打印 OpenCode v2 客户端方法的**解析后**类型形状。
//
// 为什么需要它：`@opencode/client` 生成的 d.ts 里，入参类型是「自引用查表」形式
// （`{ ...字段 }["字段名"]`），直接读声明会得到无意义的结果。用 TypeScript
// 编译器 API 解析才能拿到真实形状。
//
// 用法：
//   node scripts/v2-resolve.mjs session.create session.prompt
//   node scripts/v2-resolve.mjs --depth=3 session.create
//
// 注意：本文件放在 scripts/ 而不是 node_modules/，因为 npm install/uninstall
// 会清理 node_modules 下的非包文件。

import ts from 'typescript'
import path from 'node:path'

const root = process.cwd()
const entry = path.join(root, 'node_modules/@opencode/client/dist/promise/index.d.ts')

const args = process.argv.slice(2)
let maxDepth = 2
const specs = []
for (const a of args) {
  const m = a.match(/^--depth=(\d+)$/)
  if (m) maxDepth = Number(m[1])
  else specs.push(a)
}

const program = ts.createProgram([entry], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
})

const checker = program.getTypeChecker()
const source = program.getSourceFile(entry)

function findExport(name) {
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source))
  return exports.find(e => e.getName() === name)
}

const clientSym = findExport('OpenCodeClient')
if (!clientSym) {
  console.error('OpenCodeClient not found — is @opencode/client installed?')
  process.exit(1)
}
const clientType = checker.getDeclaredTypeOfSymbol(clientSym)

function render(type, depth, seen) {
  if (depth < 0) return '...'

  const flags = type.getFlags()
  if (flags & ts.TypeFlags.StringLike) return checker.typeToString(type)
  if (flags & ts.TypeFlags.NumberLike) return checker.typeToString(type)
  if (flags & ts.TypeFlags.BooleanLike) return checker.typeToString(type)
  if (flags & ts.TypeFlags.Null) return 'null'
  if (flags & ts.TypeFlags.Undefined) return 'undefined'

  if (type.isUnion()) {
    return [...new Set(type.types.map(t => render(t, depth, seen)))].join(' | ')
  }
  if (type.isIntersection()) {
    return type.types.map(t => render(t, depth, seen)).join(' & ')
  }

  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const typeArgs = checker.getTypeArguments(type)
    if (typeArgs.length === 1) return render(typeArgs[0], depth - 1, seen) + '[]'
    return '[' + typeArgs.map(t => render(t, depth - 1, seen)).join(', ') + ']'
  }

  const props = type.getProperties()
  if (props.length === 0) return checker.typeToString(type)

  if (seen.has(type.id)) return checker.typeToString(type)
  const nextSeen = new Set(seen)
  nextSeen.add(type.id)

  const lines = props
    .filter(p => !(p.flags & ts.SymbolFlags.Method))
    .map(p => {
      const pt = checker.getTypeOfSymbolAtLocation(p, p.valueDeclaration ?? source)
      const optional = p.flags & ts.SymbolFlags.Optional ? '?' : ''
      return `  ${p.getName()}${optional}: ${render(pt, depth - 1, nextSeen)}`
    })

  for (const ii of checker.getIndexInfosOfType(type)) {
    lines.push(`  [key: ${checker.typeToString(ii.keyType)}]: ${render(ii.type, depth - 1, nextSeen)}`)
  }

  return '{\n' + lines.join('\n') + '\n}'
}

function resolvePath(spec) {
  const parts = spec.split('.')
  let current = clientType
  const trail = []
  for (const p of parts) {
    trail.push(p)
    const prop = current.getProperty(p)
    if (!prop) return { error: `no property '${p}' on '${trail.slice(0, -1).join('.') || 'client'}'` }
    current = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration ?? source)
  }
  return { type: current }
}

for (const spec of specs) {
  console.log('=== ' + spec + ' ===')
  const r = resolvePath(spec)
  if (r.error) {
    console.log('ERROR: ' + r.error)
    console.log()
    continue
  }
  const sigs = r.type.getCallSignatures()
  if (sigs.length === 0) {
    console.log('(not callable)')
    console.log()
    continue
  }
  for (const sig of sigs) {
    for (const p of sig.getParameters()) {
      if (p.getName() === 'requestOptions') continue
      const pt = checker.getTypeOfSymbolAtLocation(p, p.valueDeclaration ?? source)
      const optional = p.flags & ts.SymbolFlags.Optional ? '?' : ''
      console.log(`(${p.getName()}${optional}) ${render(pt, maxDepth, new Set())}`)
    }
    const ret = checker.getReturnTypeOfSignature(sig)
    const awaited = checker.getAwaitedType(ret) ?? ret
    console.log('(returns) ' + render(awaited, maxDepth, new Set()))
  }
  console.log()
}
