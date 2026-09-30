// ============================================
// src/api/file.ts 单元测试（阶段 3a）
// ============================================
//
// 这些测试锁住的是「V2 瘦结构 → V1 形状」的转换约定。
// 之所以值得单独测：转换错了**不会报错**，只会让 UI 表现异常（目录名消失、
// 改动状态颜色整片失效、二进制文件被当文本渲染……），排查成本极高。
//
// 锁定的关键点：
//   1. `fs/list` 的 `{ location, data }` 必须解包，且 `location[directory]` 必须传对
//   2. V2 的**目录条目 path 带尾斜杠**（`src/`）→ 必须剥掉
//      （否则 `name` 是空串、且与 `/api/vcs/status` 的键对不上）
//   3. `absolute` 是前端拼的（V2 不返回），要覆盖 `path='.'`、目录带尾斜杠两种边界
//   4. `ignored` 恒 false（V2 没有这个概念）
//   5. `fs/read` 返回裸字节 → 文本/二进制判定 + base64 编码全在前端
//   6. 大文件 base64 不能爆栈（分块编码）
//   7. `vcs/status` 的字段名映射（file→path、additions→added、deletions→removed）

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDirectoryCache, getFileContent, getFileStatus, listDirectory, prefetchRootDirectory } from './file'

const listMock = vi.fn()
const readMock = vi.fn()
const statusMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    file: {
      list: (...args: unknown[]) => listMock(...args),
      read: (...args: unknown[]) => readMock(...args),
    },
    vcs: {
      status: (...args: unknown[]) => statusMock(...args),
    },
  }),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'test-server',
  },
}))

/** 把字符串编成 UTF-8 字节，模拟 `fs/read` 的返回 */
function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

describe('listDirectory（V2 `GET /api/fs/list` → V1 FileNode）', () => {
  beforeEach(() => {
    listMock.mockReset()
    clearDirectoryCache()
  })

  it('解包 { location, data } 并映射成内部 FileNode 形状（阶段 3b：不再有 ignored）', async () => {
    listMock.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        { path: 'README.md', type: 'file' },
        { path: 'src', type: 'directory' },
      ],
    })

    const nodes = await listDirectory('src', '/repo')

    // location 必须走 deepObject 的 location[directory]
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'src',
        location: { directory: '/repo' },
      }),
    )
    // ⛔ 阶段 3b：`ignored` 字段已删除（V2 的 fs/list 不返回 gitignore 标记）
    expect(nodes).toEqual([
      { name: 'README.md', path: 'README.md', absolute: '/repo/README.md', type: 'file' },
      { name: 'src', path: 'src', absolute: '/repo/src', type: 'directory' },
    ])
  })

  it('剥掉 V2 目录条目的尾斜杠（否则 name 为空、且与 vcs/status 的键对不上）', async () => {
    listMock.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        { path: 'src/', type: 'directory' },
        { path: 'src/components/', type: 'directory' },
        { path: 'src/a.ts', type: 'file' },
      ],
    })

    const nodes = await listDirectory('src', '/repo')

    expect(nodes.map(n => [n.name, n.path])).toEqual([
      ['src', 'src'],
      ['components', 'src/components'],
      ['a.ts', 'src/a.ts'],
    ])
    // absolute 不能出现双斜杠
    expect(nodes.map(n => n.absolute)).toEqual(['/repo/src', '/repo/src/components', '/repo/src/a.ts'])
  })

  it('path="." 时 absolute 就是 location 目录本身', async () => {
    listMock.mockResolvedValue({
      location: { directory: '/repo' },
      data: [{ path: '.', type: 'directory' }],
    })

    const [node] = await listDirectory('.', '/repo')

    expect(node.name).toBe('.')
    expect(node.path).toBe('.')
    expect(node.absolute).toBe('/repo')
  })

  it('location 目录带尾斜杠时 absolute 不会出现双斜杠', async () => {
    listMock.mockResolvedValue({
      location: { directory: '/repo' },
      data: [{ path: 'src', type: 'directory' }],
    })

    const [node] = await listDirectory('', '/repo/')

    // formatPathForApi 会去掉尾斜杠后再拼
    expect(node.absolute).toBe('/repo/src')
  })

  it('根路径 `/` 作为 location 时 absolute 保留前导斜杠', async () => {
    listMock.mockResolvedValue({
      location: { directory: '/' },
      data: [{ path: 'etc', type: 'directory' }],
    })

    const [node] = await listDirectory('.', '/')

    expect(node.absolute).toBe('/etc')
  })

  it('路径分隔符统一成正斜杠（Windows 目录也能拼出可用的绝对路径）', async () => {
    listMock.mockResolvedValue({
      location: { directory: 'C:/repo' },
      data: [{ path: 'src\\a.ts', type: 'file' }],
    })

    const [node] = await listDirectory('src', 'C:\\repo')

    expect(node.name).toBe('a.ts')
    expect(node.absolute).toBe('C:/repo/src/a.ts')
  })

  it('空串 / "." 都表示根目录，且两者共用同一条根目录缓存', async () => {
    listMock.mockResolvedValue({ location: { directory: '/repo' }, data: [] })

    await listDirectory('', '/repo')
    await listDirectory('.', '/repo')

    // 10s TTL 内第二次命中缓存 → 只打了一次请求
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('options.force 绕开根目录 TTL 缓存（自动刷新链路用）', async () => {
    listMock.mockResolvedValue({ location: { directory: '/repo-force' }, data: [] })

    await listDirectory('', '/repo-force')
    await listDirectory('', '/repo-force', undefined, { force: true })

    // 第一次建缓存，第二次强制重拉 → 两次请求
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('并发请求同一个根目录会去重（inflight 合并）', async () => {
    listMock.mockResolvedValue({ location: { directory: '/repo-concurrent' }, data: [] })

    await Promise.all([
      listDirectory('', '/repo-concurrent'),
      listDirectory('.', '/repo-concurrent'),
      listDirectory('', '/repo-concurrent'),
    ])

    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('prefetchRootDirectory 预热的就是根目录', async () => {
    listMock.mockResolvedValue({ location: { directory: '/repo' }, data: [] })

    await prefetchRootDirectory('/repo')

    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ path: '.', location: { directory: '/repo' } }))
  })

  it('绝对路径 + 未指定 location → 把该绝对路径当成 location 列它的根（ProjectDialog 依赖）', async () => {
    listMock.mockResolvedValue({
      location: { directory: '/repo/src' },
      data: [{ path: 'components/', type: 'directory' }],
    })

    const [node] = await listDirectory('/repo/src')

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '',
        location: { directory: '/repo/src' },
      }),
    )
    expect(node.absolute).toBe('/repo/src/components')
  })
})

describe('getFileContent（V2 `GET /api/fs/read/*` 裸字节 → V1 FileContent）', () => {
  beforeEach(() => {
    readMock.mockReset()
  })

  it('文本文件：UTF-8 解码，mimeType 按扩展名推断', async () => {
    readMock.mockResolvedValue(utf8('hello 世界\n'))

    const content = await getFileContent('docs/note.md', '/repo')

    expect(readMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'docs/note.md', location: { directory: '/repo' } }),
    )
    expect(content).toEqual({ type: 'text', content: 'hello 世界\n', mimeType: 'text/markdown' })
    // 文本路径不能带 encoding:base64（下游靠它判断要不要 atob）
    expect(content.encoding).toBeUndefined()
  })

  it('.ts 必须是文本（服务端自己的 content-type 是 video/mp2t，SDK 又把它丢了）', async () => {
    readMock.mockResolvedValue(utf8('export const a = 1\n'))

    const content = await getFileContent('src/a.ts', '/repo')

    expect(content.type).toBe('text')
    expect(content.mimeType).toBe('text/typescript')
  })

  it('json / xml / svg 的 mime 不带 text/ 前缀，但仍要按文本解码', async () => {
    readMock.mockResolvedValue(utf8('{"a":1}'))
    const json = await getFileContent('package.json', '/repo')
    expect(json).toMatchObject({ type: 'text', mimeType: 'application/json' })

    readMock.mockResolvedValue(utf8('<svg/>'))
    const svg = await getFileContent('logo.svg', '/repo')
    // svg 是「文本型媒体」：FileExplorer 靠 mimeType 走 isTextualMedia 分支
    expect(svg).toMatchObject({ type: 'text', mimeType: 'image/svg+xml' })
  })

  it('二进制文件：base64 + encoding:base64', async () => {
    // 1x1 透明 PNG 的头部字节（含 NUL，但这里靠扩展名判定）
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02])
    readMock.mockResolvedValue(pngBytes)

    const content = await getFileContent('assets/logo.png', '/repo')

    expect(content).toEqual({
      type: 'binary',
      content: btoa(String.fromCharCode(...pngBytes)),
      encoding: 'base64',
      mimeType: 'image/png',
    })
  })

  it('超大文件（>50MB）拒绝预览，抛出带大小与上限的中文提示', async () => {
    // 只分配 50MB+1 字节，不真读 50MB 内容
    readMock.mockResolvedValue(new Uint8Array(50 * 1024 * 1024 + 1))

    await expect(getFileContent('huge.log', '/repo')).rejects.toThrow(/文件过大，无法预览/)
    await expect(getFileContent('huge.log', '/repo')).rejects.toThrow(/上限 50\.0 MB/)
  })

  it('未知扩展名 + 前 8KB 含 NUL 字节 → 判为二进制', async () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x00, 0x63])
    readMock.mockResolvedValue(bytes)

    const content = await getFileContent('mystery.bin', '/repo')

    expect(content).toMatchObject({
      type: 'binary',
      encoding: 'base64',
      mimeType: 'application/octet-stream',
    })
  })

  it('未知扩展名 + 无 NUL 字节 → 判为文本（Dockerfile / 无扩展名脚本）', async () => {
    readMock.mockResolvedValue(utf8('FROM node:22\n'))

    const content = await getFileContent('Dockerfile', '/repo')

    expect(content).toEqual({ type: 'text', content: 'FROM node:22\n', mimeType: 'application/octet-stream' })
  })

  it('点开头的文件（.gitignore）没有扩展名 → 走嗅探，按文本返回', async () => {
    readMock.mockResolvedValue(utf8('node_modules\n'))

    const content = await getFileContent('.gitignore', '/repo')

    expect(content).toMatchObject({ type: 'text', content: 'node_modules\n' })
  })

  it('NUL 字节出现在 8KB 嗅探窗口之外时不误判（只嗅前 8KB）', async () => {
    const bytes = new Uint8Array(9000)
    bytes.fill(0x61)
    bytes[8500] = 0
    readMock.mockResolvedValue(bytes)

    const content = await getFileContent('long.unknownext', '/repo')

    expect(content.type).toBe('text')
  })

  it('非法 UTF-8 字节用替换字符兜底而不是抛错', async () => {
    readMock.mockResolvedValue(new Uint8Array([0xff, 0xfe]))

    const content = await getFileContent('broken.txt', '/repo')

    expect(content.type).toBe('text')
    expect(content.content).toContain('\uFFFD')
  })

  it('空文件返回空文本', async () => {
    readMock.mockResolvedValue(new Uint8Array(0))

    const content = await getFileContent('empty.txt', '/repo')

    expect(content).toEqual({ type: 'text', content: '', mimeType: 'text/plain' })
  })

  it('> 100KB 的二进制文件不会爆栈，且 base64 长度正确', async () => {
    const size = 200_000
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) bytes[i] = i % 256
    readMock.mockResolvedValue(bytes)

    const content = await getFileContent('big.bin', '/repo')

    expect(content.type).toBe('binary')
    // base64 长度 = 4 * ceil(n / 3)
    expect(content.content.length).toBe(4 * Math.ceil(size / 3))
    // 抽样核对前几个字节的解码结果（确认不是把内容编错）
    expect(atob(content.content.slice(0, 8))).toBe(String.fromCharCode(0, 1, 2, 3, 4, 5))
  })

  it('> 100KB 的文本文件也不会爆栈', async () => {
    const bytes = utf8('a'.repeat(150_000))
    readMock.mockResolvedValue(bytes)

    const content = await getFileContent('big.log', '/repo')

    expect(content.type).toBe('text')
    expect(content.content.length).toBe(150_000)
  })
})

describe('getFileStatus（V2 `GET /api/vcs/status` → V1 FileStatusItem）', () => {
  beforeEach(() => {
    statusMock.mockReset()
  })

  it('字段名映射 file→path / additions→added / deletions→removed', async () => {
    statusMock.mockResolvedValue({
      location: { directory: '/repo' },
      data: [
        { file: 'src/a.ts', additions: 3, deletions: 1, status: 'modified' },
        { file: 'src/new.txt', additions: 2, deletions: 0, status: 'added' },
        { file: 'src/gone.ts', additions: 0, deletions: 7, status: 'deleted' },
      ],
    })

    const statuses = await getFileStatus('/repo')

    expect(statusMock).toHaveBeenCalledWith({ location: { directory: '/repo' } })
    expect(statuses).toEqual([
      { path: 'src/a.ts', added: 3, removed: 1, status: 'modified' },
      { path: 'src/new.txt', added: 2, removed: 0, status: 'added' },
      { path: 'src/gone.ts', added: 0, removed: 7, status: 'deleted' },
    ])
    // V1 形状里没有 file / additions / deletions 这几个键
    expect(statuses[0]).not.toHaveProperty('file')
  })

  it('非 git 目录（200 + 空数组）返回空数组', async () => {
    statusMock.mockResolvedValue({ location: { directory: '/nogit' }, data: [] })

    await expect(getFileStatus('/nogit')).resolves.toEqual([])
  })

  it('未指定目录时 location 缺省（服务端回落 cwd）', async () => {
    statusMock.mockResolvedValue({ location: { directory: '/cwd' }, data: [] })

    await getFileStatus()

    expect(statusMock).toHaveBeenCalledWith({})
  })
})
