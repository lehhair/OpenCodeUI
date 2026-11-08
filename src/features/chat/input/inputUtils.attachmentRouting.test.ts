import { describe, expect, it } from 'vitest'
import { MAX_INLINE_BYTES, MAX_UPLOAD_BYTES, isFileSupported, routeAttachment } from './inputUtils'

// ============================================
// 附件分发（Issue #182）
//
// 三路规则来自服务端的两条硬约束：
//   1. 读 `files[].uri` 时超过 20MB 直接 AttachmentError（整条 prompt 失败）
//   2. 非 text/image/pdf 的 mime 在转 LLM 时被丢弃 → 只能靠文本里的路径
// 因此「原生媒体且未超限」内联；其余上传；超限只作路径引用/拒绝。
// ============================================

const allCaps = { image: true, pdf: true, audio: true, video: true }
const noCaps = { image: false, pdf: false, audio: false, video: false }

describe('routeAttachment', () => {
  it('原生媒体且未超限 → 内联', () => {
    expect(routeAttachment({ mime: 'image/png', size: 1024, caps: allCaps, serverIsLocal: false })).toEqual({
      kind: 'inline',
    })
    expect(routeAttachment({ mime: 'application/pdf', size: MAX_INLINE_BYTES, caps: allCaps, serverIsLocal: false })).toEqual(
      { kind: 'inline' },
    )
  })

  it('白名单外（zip 等）→ 上传，且只作路径引用（二进制不进上下文）', () => {
    expect(
      routeAttachment({ mime: 'application/zip', size: 1024, caps: allCaps, serverIsLocal: false }),
    ).toEqual({ kind: 'upload', pathOnly: true })
  })

  it('文本小文件 → 上传，可以进 files[]（模型能直接读）', () => {
    expect(
      routeAttachment({ mime: 'text/plain', size: 1024, caps: allCaps, serverIsLocal: false }),
    ).toEqual({ kind: 'upload', pathOnly: false })
  })

  it('原生媒体但超过 20MB → 上传且只作路径引用（不能进 files[]）', () => {
    expect(
      routeAttachment({ mime: 'image/png', size: MAX_INLINE_BYTES + 1, caps: allCaps, serverIsLocal: false }),
    ).toEqual({ kind: 'upload', pathOnly: true })
  })

  it('模型没有任何文件能力时，图片也走上传（不再被丢弃）', () => {
    expect(routeAttachment({ mime: 'image/png', size: 1024, caps: noCaps, serverIsLocal: false })).toEqual({
      kind: 'upload',
      pathOnly: false,
    })
    expect(isFileSupported('image/png', noCaps)).toBe(false)
  })

  it('超过上传上限 → 拒绝', () => {
    expect(
      routeAttachment({ mime: 'application/zip', size: MAX_UPLOAD_BYTES + 1, caps: allCaps, serverIsLocal: false }),
    ).toEqual({ kind: 'reject', reason: 'too-large' })
  })

  it('服务端同机 + 有原生路径 → 直引（需求二）；二进制或超限只作路径引用', () => {
    expect(
      routeAttachment({
        mime: 'application/zip',
        size: 1024,
        caps: allCaps,
        serverIsLocal: true,
        nativePath: 'C:/data/report.zip',
      }),
    ).toEqual({ kind: 'reference', path: 'C:/data/report.zip', pathOnly: true })

    expect(
      routeAttachment({
        mime: 'text/plain',
        size: 1024,
        caps: allCaps,
        serverIsLocal: true,
        nativePath: 'C:/data/notes.txt',
      }),
    ).toEqual({ kind: 'reference', path: 'C:/data/notes.txt', pathOnly: false })

    expect(
      routeAttachment({
        mime: 'application/zip',
        size: MAX_INLINE_BYTES + 1,
        caps: allCaps,
        serverIsLocal: true,
        nativePath: 'C:/data/big.zip',
      }),
    ).toEqual({ kind: 'reference', path: 'C:/data/big.zip', pathOnly: true })
  })

  it('服务端在远端时即使拿到本机路径也只能上传', () => {
    expect(
      routeAttachment({
        mime: 'application/zip',
        size: 1024,
        caps: allCaps,
        serverIsLocal: false,
        nativePath: 'C:/data/report.zip',
      }),
    ).toEqual({ kind: 'upload', pathOnly: true })
  })
})
