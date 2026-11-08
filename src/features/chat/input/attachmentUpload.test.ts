import { describe, expect, it, vi } from 'vitest'
import { buildPathAttachment, canReferenceLocalPath, decideNativeFileRoute, splitDroppedItems } from './attachmentUpload'

// ============================================
// 桌面端拖入的本机文件该走哪条路（需求二）
//
// 服务端与客户端同机时**不上传**：原生媒体内联，其余沿用原有的 @ 引用
// （服务端自己读得到那个路径）。服务端在远端时只能上传。
// ============================================

const allCaps = { image: true, pdf: true, audio: true, video: true }
const noCaps = { image: false, pdf: false, audio: false, video: false }
const MB = 1024 * 1024

describe('decideNativeFileRoute', () => {
  it('同机 + 原生媒体 → 内联（读本机字节，不上传）', () => {
    expect(
      decideNativeFileRoute({
        mime: 'image/png',
        size: 1024,
        caps: allCaps,
        serverIsLocal: true,
        nativePath: 'C:/pics/a.png',
      }),
    ).toEqual({ kind: 'inline' })
  })

  it('同机 + 白名单外（zip）→ 走 @ 引用，但只给路径（二进制不进上下文）', () => {
    expect(
      decideNativeFileRoute({
        mime: 'application/zip',
        size: 1024,
        caps: allCaps,
        serverIsLocal: true,
        nativePath: 'C:/dl/piui-source.zip',
      }),
    ).toEqual({ kind: 'mention', pathOnly: true })
  })

  it('同机 + 小文本文件 → @ 引用且进 files[]（模型能直接读）', () => {
    expect(
      decideNativeFileRoute({
        mime: 'text/plain',
        size: 1024,
        caps: allCaps,
        serverIsLocal: true,
        nativePath: 'C:/proj/notes.txt',
      }),
    ).toEqual({ kind: 'mention', pathOnly: false })
  })

  it('同机 + 原生媒体但超过内联上限 → 只给路径（不进 files[]）', () => {
    expect(
      decideNativeFileRoute({
        mime: 'image/png',
        size: 21 * MB,
        caps: allCaps,
        serverIsLocal: true,
        nativePath: 'C:/pics/huge.png',
      }),
    ).toEqual({ kind: 'mention', pathOnly: true })
  })

  it('同机 + 超大文件也不拒绝（根本不上传，没有上限问题）', () => {
    expect(
      decideNativeFileRoute({
        mime: 'application/zip',
        size: 500 * MB,
        caps: allCaps,
        serverIsLocal: true,
        nativePath: 'C:/dl/huge.zip',
      }),
    ).toEqual({ kind: 'mention', pathOnly: true })
  })

  it('远端 + 白名单外 → 上传，但只作路径引用', () => {
    expect(
      decideNativeFileRoute({
        mime: 'application/zip',
        size: 1024,
        caps: allCaps,
        serverIsLocal: false,
        nativePath: 'C:/dl/piui-source.zip',
      }),
    ).toEqual({ kind: 'upload', pathOnly: true })
  })

  it('远端 + 超过 20MB → 上传但只作路径引用', () => {
    expect(
      decideNativeFileRoute({
        mime: 'application/zip',
        size: 21 * MB,
        caps: allCaps,
        serverIsLocal: false,
        nativePath: 'C:/dl/big.zip',
      }),
    ).toEqual({ kind: 'upload', pathOnly: true })
  })

  it('远端 + 超过上传上限 → 拒绝', () => {
    expect(
      decideNativeFileRoute({
        mime: 'application/zip',
        size: 300 * MB,
        caps: allCaps,
        serverIsLocal: false,
        nativePath: 'C:/dl/huge.zip',
      }),
    ).toEqual({ kind: 'reject' })
  })

  it('远端 + 模型没有原生能力 + 图片 → 上传（不丢弃）', () => {
    expect(
      decideNativeFileRoute({
        mime: 'image/png',
        size: 1024,
        caps: noCaps,
        serverIsLocal: false,
        nativePath: 'C:/pics/a.png',
      }),
    ).toEqual({ kind: 'upload', pathOnly: false })
  })
})

describe('buildPathAttachment', () => {
  it('用 file:// 引用服务端路径，原始文件名用于展示', () => {
    expect(
      buildPathAttachment({
        id: 'a1',
        path: 'C:/Users/x/AppData/Local/Temp/opencode/uploads/u1/report.zip',
        filename: 'report.zip',
        mime: 'application/zip',
        size: 262,
        pathOnly: false,
      }),
    ).toEqual({
      id: 'a1',
      type: 'file',
      displayName: 'report.zip',
      url: 'file:///C:/Users/x/AppData/Local/Temp/opencode/uploads/u1/report.zip',
      mime: 'application/zip',
      relativePath: 'C:/Users/x/AppData/Local/Temp/opencode/uploads/u1/report.zip',
      size: 262,
    })
  })

  it('pathOnly 时标记出来（不进 prompt.files[]）', () => {
    const attachment = buildPathAttachment({
      id: 'a2',
      path: '/tmp/uploads/u1/big.bin',
      filename: 'big.bin',
      mime: 'application/octet-stream',
      size: 21 * MB,
      pathOnly: true,
    })
    expect(attachment.pathOnly).toBe(true)
    expect(attachment.url).toBe('file:///tmp/uploads/u1/big.bin')
  })
})

// ============================================
// 能否直接引用本机路径（「是不是本地」的最终判据）
//
// URL 判本地不够：本机也能用局域网地址连自己；容器也会把端口映射到回环。
// 所以除了应用自己拉起的服务（必然同机，免探测），一律问服务端读不读得到。
// ============================================

describe('canReferenceLocalPath', () => {
  it('应用自己拉起的服务（local）必然同机：免探测直接可用', async () => {
    const probe = vi.fn(async () => false)

    await expect(
      canReferenceLocalPath({ path: 'C:/x/a.zip', pinnedLocal: true, probe }),
    ).resolves.toBe(true)
    expect(probe).not.toHaveBeenCalled()
  })

  it('本机但用局域网地址连自己：探测通过 → 可直接引用（不上传）', async () => {
    const probe = vi.fn(async () => true)

    await expect(
      canReferenceLocalPath({ path: 'C:/x/a.zip', pinnedLocal: false, serverId: 'lan', probe }),
    ).resolves.toBe(true)
    expect(probe).toHaveBeenCalledWith('C:/x/a.zip', undefined, 'lan')
  })

  it('容器/远端读不到宿主路径：探测失败 → 必须上传', async () => {
    const probe = vi.fn(async () => false)
    await expect(canReferenceLocalPath({ path: 'C:/x/a.zip', pinnedLocal: false, probe })).resolves.toBe(false)
  })

  it('探测本身抛错（服务端不可达）：按读不到处理，不抛出去', async () => {
    const probe = vi.fn(async () => {
      throw new Error('Failed to fetch')
    })
    await expect(canReferenceLocalPath({ path: 'C:/x/a.zip', pinnedLocal: false, probe })).resolves.toBe(false)
  })
})

// ============================================
// 网页版拖入：文件夹必须在上传前被认出来
//
// 浏览器把拖入的文件夹也塞进 dataTransfer.files，表现为 size 0、type 空的 File。
// 直接上传会得到一个空附件，请求还会被安全策略挡掉（net::ERR_ACCESS_DENIED），
// 所以分流只能靠 webkitGetAsEntry().isDirectory。
// ============================================

describe('splitDroppedItems', () => {
  const file = (name: string) => new File(['x'], name, { type: 'text/plain' })
  const fileItem = (f: File | null) => ({ kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => f })
  const folderItem = (name: string) => ({
    kind: 'file',
    webkitGetAsEntry: () => ({ isDirectory: true, name }),
    getAsFile: () => null,
  })

  it('文件夹被单独挑出来，不进 files（否则会传上空附件）', () => {
    const result = splitDroppedItems([fileItem(file('a.txt')), folderItem('新建文件夹')])

    expect(result.folderNames).toEqual(['新建文件夹'])
    expect(result.files.map(f => f.name)).toEqual(['a.txt'])
  })

  it('混着拖：真文件照常收下', () => {
    const result = splitDroppedItems([folderItem('dir'), fileItem(file('a.txt')), fileItem(file('b.zip'))])

    expect(result.folderNames).toEqual(['dir'])
    expect(result.files.map(f => f.name)).toEqual(['a.txt', 'b.zip'])
  })

  it('空文件是合法文件，不能被当成文件夹漏掉', () => {
    const empty = new File([], 'empty.txt', { type: 'text/plain' })
    const result = splitDroppedItems([fileItem(empty)])

    expect(result.folderNames).toEqual([])
    expect(result.files).toHaveLength(1)
  })

  it('没有 webkitGetAsEntry 的环境退回 getAsFile（老浏览器 / 非拖拽来源）', () => {
    const result = splitDroppedItems([{ kind: 'file', getAsFile: () => file('a.txt') }])

    expect(result.folderNames).toEqual([])
    expect(result.files.map(f => f.name)).toEqual(['a.txt'])
  })

  it('非文件条目（如拖入文本）忽略', () => {
    const result = splitDroppedItems([{ kind: 'string', getAsFile: () => null }])

    expect(result.folderNames).toEqual([])
    expect(result.files).toEqual([])
  })

  it('只拖了文件夹时绝不回退到 fallback（否则文件夹又被捞回去上传）', () => {
    // 浏览器里被拖入的文件夹同时存在于 items 和 files：files 里那个假 File
    // 正是失败上传的来源（ERR_ACCESS_DENIED），所以有 items 时就不能用它兜底
    const folderAsFile = new File([], '新建文件夹', { type: '' })
    const result = splitDroppedItems([folderItem('新建文件夹')], [folderAsFile])

    expect(result.folderNames).toEqual(['新建文件夹'])
    expect(result.files).toEqual([])
  })

  it('没有 items 可用时才用 fallback（拿不到 entry 的老环境）', () => {
    const fallback = new File(['x'], 'a.txt', { type: 'text/plain' })
    const result = splitDroppedItems([], [fallback])

    expect(result.folderNames).toEqual([])
    expect(result.files.map(f => f.name)).toEqual(['a.txt'])
  })
})
