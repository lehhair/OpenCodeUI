import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputBox } from './InputBox'

let selectedFiles: File[] = []
/** 桌面端选择器返回的本机路径 */
let selectedPaths: string[] = []

const uploadAttachmentMock = vi.fn()
const uploadLocalFileMock = vi.fn()
const createUploadIdMock = vi.fn(() => `upload-${uploadAttachmentMock.mock.calls.length}`)
const notifyPushMock = vi.fn()
const getDroppedPathsInfoMock = vi.fn(async (paths: string[]) =>
  paths.map(path => ({ type: 'file' as const, path, name: path.split(/[/\\]/).pop() || 'file' })),
)

vi.mock('../../lib/tauriDragDrop', () => ({
  getDroppedPathsInfo: (paths: string[]) => getDroppedPathsInfoMock(paths),
  isTauriDropPointInsideElement: () => false,
  subscribeTauriDragDrop: () => () => {},
}))

vi.mock('../../api/file', () => ({
  uploadAttachment: (...args: unknown[]) => uploadAttachmentMock(...args),
  // 桌面端（本机路径）走 Rust 流式上传：这里只验证「路径被交给它」，不测 Rust
  uploadLocalFile: (...args: unknown[]) => uploadLocalFileMock(...args),
  createUploadId: () => createUploadIdMock(),
  probeServerPath: vi.fn(async () => true),
}))

vi.mock('../../store/notificationStore', () => ({
  notificationStore: {
    push: (...args: unknown[]) => notifyPushMock(...args),
  },
}))

vi.mock('../attachment', () => ({
  AttachmentPreview: ({
    attachments,
    onRetry,
  }: {
    attachments: Array<{ id: string; url?: string; uploadStatus?: string; progress?: number; pathOnly?: boolean }>
    onRetry?: (id: string) => void
  }) => (
    <div data-testid="attachment-count">
      {attachments.length}
      {attachments.map(attachment => (
        <span key={attachment.id} data-testid="attachment-meta">
          {`${attachment.url ?? ''}|${attachment.uploadStatus ?? ''}|${attachment.progress ?? ''}`}
          {attachment.pathOnly ? '|pathOnly' : ''}
        </span>
      ))}
      {attachments
        .filter(attachment => attachment.uploadStatus === 'failed')
        .map(attachment => (
          <button key={`retry-${attachment.id}`} type="button" onClick={() => onRetry?.(attachment.id)}>
            retry upload
          </button>
        ))}
    </div>
  ),
}))

vi.mock('./chatViewport', () => ({
  useChatViewport: () => ({
    presentation: { surfaceVariant: 'desktop', isCompact: false },
    interaction: {
      mode: 'pointer',
      touchCapable: false,
      sidebarBehavior: 'docked',
      rightPanelBehavior: 'docked',
      bottomPanelBehavior: 'docked',
      outlineInteraction: 'pointer',
      enableCollapsedInputDock: false,
    },
  }),
}))

vi.mock('../mention', () => ({
  MentionMenu: () => null,
  detectMentionTrigger: () => null,
  normalizePath: (value: string) => value,
  toFileUrl: (value: string) => `file://${value}`,
}))

vi.mock('../slash-command', () => ({
  SlashCommandMenu: () => null,
}))

vi.mock('./input/InputToolbar', () => ({
  InputToolbar: ({
    onFilesSelected,
    onPickedPaths,
  }: {
    onFilesSelected: (files: File[]) => void
    onPickedPaths?: (paths: string[]) => void
  }) => (
    <>
      <button type="button" onClick={() => onFilesSelected(selectedFiles)}>
        attach file
      </button>
      <button type="button" onClick={() => onPickedPaths?.(selectedPaths)}>
        pick paths
      </button>
    </>
  ),
}))

vi.mock('./input/InputFooter', () => ({
  InputFooter: () => null,
}))

const statMock = vi.fn(async (_path: string) => ({ size: 262 }))
const readFileMock = vi.fn(async (_path: string) => new Uint8Array([1, 2, 3]))

vi.mock('@tauri-apps/plugin-fs', () => ({
  stat: (path: string) => statMock(path),
  readFile: (path: string) => readFileMock(path),
}))

vi.mock('./input/UndoStatus', () => ({
  UndoStatus: () => null,
}))

vi.mock('../../hooks', () => ({
  useIsMobile: () => false,
  usePresence: (show: boolean) => ({ shouldRender: show, ref: { current: null } }),
}))

vi.mock('../../store/messageStoreHooks', () => ({
  useMessages: () => [],
  useCurrentSessionId: () => null,
  useSessionPromptHistory: () => [],
}))

vi.mock('../../store/keybindingStore', () => ({
  keybindingStore: {
    getKey: () => null,
  },
  matchesKeybinding: () => false,
}))

describe('InputBox attachment handling', () => {
  beforeEach(() => {
    selectedFiles = []
    selectedPaths = []
    uploadAttachmentMock.mockReset()
    uploadLocalFileMock.mockReset()
    createUploadIdMock.mockClear()
    notifyPushMock.mockReset()
    getDroppedPathsInfoMock.mockClear()
    statMock.mockClear()
    readFileMock.mockClear()
  })

  it('accepts files whose mime is inferred from the filename extension', async () => {
    selectedFiles = [new File(['image'], 'photo.png')]

    render(
      <InputBox
        paneId="pane-test"
        onSend={vi.fn()}
        fileCapabilities={{ image: true, pdf: false, audio: false, video: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'attach file' }))

    await waitFor(() => {
      expect(screen.getByTestId('attachment-count')).toHaveTextContent('1')
    })
  })

  // ==========================================
  // Issue #182：白名单外的文件不再被静默丢弃
  // ==========================================

  it('白名单外文件上传到服务端并成为路径附件（模型无任何原生能力时也成立）', async () => {
    uploadAttachmentMock.mockResolvedValue({ path: '/srv/tmp/uploads/u1/report.zip', size: 3 })
    selectedFiles = [new File([new Uint8Array([1, 2, 3])], 'report.zip', { type: 'application/zip' })]

    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'attach file' }))

    await waitFor(() => {
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(1)
    })

    // 上传的是原始 File，文件名原样传递
    expect(uploadAttachmentMock.mock.calls[0][1]).toBe('report.zip')

    await waitFor(() => {
      expect(screen.getByTestId('attachment-meta')).toHaveTextContent(
        'file:///srv/tmp/uploads/u1/report.zip|',
      )
    })
    expect(notifyPushMock).not.toHaveBeenCalled()
  })

  it('上传失败时保留失败态并弹出可见错误（不静默吞掉）', async () => {
    uploadAttachmentMock.mockRejectedValue(new Error('Failed to fetch'))
    selectedFiles = [new File([new Uint8Array([1])], 'report.zip', { type: 'application/zip' })]

    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'attach file' }))

    await waitFor(() => {
      expect(notifyPushMock).toHaveBeenCalledTimes(1)
    })

    const [type, title, body] = notifyPushMock.mock.calls[0] as [string, string, string]
    expect(type).toBe('error')
    expect(title).toMatch(/report\.zip/)
    expect(body).toMatch(/report\.zip/)

    await waitFor(() => {
      expect(screen.getByTestId('attachment-meta')).toHaveTextContent('|failed')
    })
  })

  it('失败后可重试：重试成功则替换为路径附件', async () => {
    uploadAttachmentMock.mockRejectedValueOnce(new Error('Failed to fetch'))
    uploadAttachmentMock.mockResolvedValueOnce({ path: '/srv/tmp/uploads/u2/report.zip', size: 1 })
    selectedFiles = [new File([new Uint8Array([1])], 'report.zip', { type: 'application/zip' })]

    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'attach file' }))

    await waitFor(() => {
      expect(screen.getByTestId('attachment-meta')).toHaveTextContent('|failed')
    })

    fireEvent.click(screen.getByRole('button', { name: 'retry upload' }))

    await waitFor(() => {
      expect(screen.getByTestId('attachment-meta')).toHaveTextContent(
        'file:///srv/tmp/uploads/u2/report.zip|',
      )
    })
    expect(uploadAttachmentMock).toHaveBeenCalledTimes(2)
  })

  it('超过上传上限的文件直接拒绝并提示，不做上传', async () => {
    // 构造一个「体积超过 MAX_UPLOAD_BYTES」的 File（不真正分配内存）
    const big = new File([new Uint8Array([1])], 'huge.bin', { type: 'application/octet-stream' })
    Object.defineProperty(big, 'size', { value: 300 * 1024 * 1024 })
    selectedFiles = [big]

    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'attach file' }))

    await waitFor(() => {
      expect(notifyPushMock).toHaveBeenCalledTimes(1)
    })
    expect(uploadAttachmentMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('attachment-count')).toHaveTextContent('0')
  })

  it('上传过程中把进度透传给胶囊（整个胶囊当进度条）', async () => {
    const deferred: { release?: () => void } = {}
    uploadAttachmentMock.mockImplementation(async (_payload, _name, _dir, _serverId, options) => {
      ;(options as { onProgress?: (fraction: number) => void } | undefined)?.onProgress?.(0.5)
      return await new Promise(resolve => {
        deferred.release = () => resolve({ path: '/srv/tmp/uploads/u5/report.zip', size: 3 })
      })
    })
    selectedFiles = [new File([new Uint8Array([1, 2, 3])], 'report.zip', { type: 'application/zip' })]

    render(<InputBox paneId="pane-test" onSend={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'attach file' }))

    // 上传还没回来：胶囊应该带着 0.5 的进度
    await waitFor(() => {
      expect(screen.getByTestId('attachment-meta')).toHaveTextContent('|uploading|0.5')
    })

    deferred.release?.()
    await waitFor(() => {
      expect(screen.getByTestId('attachment-meta')).toHaveTextContent('file:///srv/tmp/uploads/u5/report.zip|')
    })
  })

  // ==========================================
  // 桌面端点回形针选文件（Issue #182）：与拖入共用同一条判定链
  // ==========================================

  it('本机实例选文件 → @ 引用，不上传', async () => {
    selectedPaths = ['C:/dl/piui-source.zip']

    // 不传 serverId：缺省用活动服务器（测试环境下就是内置的 local，必然同机）
    render(<InputBox paneId="pane-test" onSend={vi.fn()} rootPath="E:/proj" />)

    fireEvent.click(screen.getByRole('button', { name: 'pick paths' }))

    await waitFor(() => {
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      expect(textarea.value).toContain('@C:/dl/piui-source.zip')
    })

    // 项目外的文件用绝对路径做引用；整条链路不碰上传
    expect(uploadAttachmentMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('attachment-count')).toHaveTextContent('1')
    // 引用只写路径（对齐官方 composer 的 path 部件）：不进 prompt.files[]，
    // 服务端就不会把整份文件读进内存，也不会撞上 20MB 上限
    expect(screen.getByTestId('attachment-meta')).toHaveTextContent('|pathOnly')
  })

  it('选中的是模型支持的媒体（图片）→ 内联，不占用 @，也不上传', async () => {
    selectedPaths = ['C:/pics/photo.png']

    render(
      <InputBox
        paneId="pane-test"
        onSend={vi.fn()}
        rootPath="E:/proj"
        fileCapabilities={{ image: true, pdf: false, audio: false, video: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'pick paths' }))

    // 原生媒体走内联（与拖入、与服务器在哪台机器无关）
    await waitFor(() => {
      expect(screen.getByTestId('attachment-meta')).toHaveTextContent('data:image/png;base64')
    })
    expect(readFileMock).toHaveBeenCalledWith('C:/pics/photo.png')
    expect(uploadAttachmentMock).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).not.toContain('@')
  })

  it('模型不支持图片时选中图片 → 本机实例仍按 @ 引用处理', async () => {
    selectedPaths = ['C:/pics/photo.png']

    render(
      <InputBox
        paneId="pane-test"
        onSend={vi.fn()}
        rootPath="E:/proj"
        fileCapabilities={{ image: false, pdf: false, audio: false, video: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'pick paths' }))

    await waitFor(() => {
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('@C:/pics/photo.png')
    })
    expect(uploadAttachmentMock).not.toHaveBeenCalled()
  })

  it('非本机实例选文件 → 上传（本机路径对远端服务端无意义）', async () => {
    selectedPaths = ['C:/dl/piui-source.zip']
    uploadLocalFileMock.mockResolvedValue({ path: '/srv/tmp/uploads/u9/piui-source.zip', size: 3 })

    const { serverStore } = await import('../../store/serverStore')
    const remote = serverStore.addServer({ name: 'lan', url: 'http://192.168.1.20:4096' })

    render(<InputBox paneId="pane-test" onSend={vi.fn()} serverId={remote.id} rootPath="E:/proj" />)

    fireEvent.click(screen.getByRole('button', { name: 'pick paths' }))

    await waitFor(() => {
      expect(uploadLocalFileMock).toHaveBeenCalledTimes(1)
    })
    // 桌面端把**本机路径**交给 Rust 流式上传（不再先读进渲染进程）
    expect(uploadLocalFileMock.mock.calls[0][0]).toBe('C:/dl/piui-source.zip')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).not.toContain('@')
    expect(screen.getByTestId('attachment-meta')).toHaveTextContent('file:///srv/tmp/uploads/u9/piui-source.zip')
  })

  it('多地址服务器切到内网 IP 后不再同机 → 改为上传（Issue #183）', async () => {
    selectedPaths = ['C:/dl/piui-source.zip']
    uploadLocalFileMock.mockResolvedValue({ path: '/srv/tmp/uploads/u9/piui-source.zip', size: 3 })

    const { serverStore } = await import('../../store/serverStore')
    const dual = serverStore.addServer({
      name: 'dual',
      url: 'http://127.0.0.1:4096',
      endpoints: [
        { url: 'http://127.0.0.1:4096', priority: 0 },
        { url: 'http://192.168.1.20:4096', priority: 1 },
      ],
    })

    render(<InputBox paneId="pane-test" onSend={vi.fn()} serverId={dual.id} rootPath="E:/proj" />)

    // 走回环入口时同机：引用本机路径，不上传
    fireEvent.click(screen.getByRole('button', { name: 'pick paths' }))
    await waitFor(() => {
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('@C:/dl/piui-source.zip')
    })
    expect(uploadLocalFileMock).not.toHaveBeenCalled()

    // 降级到内网 IP 后不再同机 —— 同机判定必须跟着生效地址重算
    act(() => {
      serverStore.setActiveEndpoint(dual.id, 'http://192.168.1.20:4096')
    })

    fireEvent.click(screen.getByRole('button', { name: 'pick paths' }))
    await waitFor(() => {
      expect(uploadLocalFileMock).toHaveBeenCalledTimes(1)
    })
  })
})
