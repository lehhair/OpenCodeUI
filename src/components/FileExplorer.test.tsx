import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileExplorer } from './FileExplorer'
import type { DesktopPlatform } from '../utils/tauri'

const {
  useFileExplorerMock,
  isTauriMock,
  isTauriMobileMock,
  getDesktopPlatformMock,
  revealItemInDirMock,
  searchFilesMock,
} = vi.hoisted(() => ({
  useFileExplorerMock: vi.fn(),
  isTauriMock: vi.fn(() => true),
  isTauriMobileMock: vi.fn(() => false),
  getDesktopPlatformMock: vi.fn((): DesktopPlatform => 'windows'),
  revealItemInDirMock: vi.fn(async (_path: string | string[]) => {}),
  searchFilesMock: vi.fn(),
}))

vi.mock('../hooks', () => ({
  useFileExplorer: (options?: unknown) => useFileExplorerMock(options),
}))

// 阶段 2b：`searchText`（内容搜索）已删除，文件浏览器只调 `searchFiles`（文件名搜索）
vi.mock('../api/file', () => ({
  searchFiles: (...args: unknown[]) => searchFilesMock(...args),
}))

vi.mock('../hooks/useVerticalSplitResize', () => ({
  useVerticalSplitResize: () => ({
    splitHeight: 200,
    isResizing: false,
    resetSplitHeight: vi.fn(),
    handleResizeStart: vi.fn(),
    handleTouchResizeStart: vi.fn(),
  }),
}))

vi.mock('../utils/tauri', () => ({
  isTauri: () => isTauriMock(),
  isTauriMobile: () => isTauriMobileMock(),
  getDesktopPlatform: () => getDesktopPlatformMock(),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: (path: string | string[]) => revealItemInDirMock(path),
}))

vi.mock('../lib/internalDragCore', () => ({
  startInternalDrag: vi.fn(),
}))

describe('FileExplorer', () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true)
    isTauriMobileMock.mockReturnValue(false)
    getDesktopPlatformMock.mockReturnValue('windows')
    revealItemInDirMock.mockClear()
    searchFilesMock.mockReset()
    useFileExplorerMock.mockReturnValue({
      tree: [
        {
          name: 'app.ts',
          path: 'src/app.ts',
          absolute: 'C:/repo/src/app.ts',
          type: 'file',
          ignored: false,
        },
      ],
      isLoading: false,
      error: null,
      expandedPaths: new Set<string>(),
      toggleExpand: vi.fn(),
      refresh: vi.fn(),
      previewContent: null,
      previewLoading: false,
      previewError: null,
      loadPreview: vi.fn(),
      clearPreview: vi.fn(),
      fileStatus: new Map(),
    })
  })

  it('reveals the selected file in the system explorer from the context menu', async () => {
    render(
      <FileExplorer panelTabId="files-1" directory="C:/repo" previewFile={null} previewFiles={[]} position="right" />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'app.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in File Explorer' }))

    await waitFor(() => {
      expect(revealItemInDirMock).toHaveBeenCalledWith('C:/repo/src/app.ts')
    })
  })

  it('hides the reveal action outside desktop Tauri', () => {
    isTauriMock.mockReturnValue(false)

    render(
      <FileExplorer panelTabId="files-1" directory="C:/repo" previewFile={null} previewFiles={[]} position="right" />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'app.ts' }))
    expect(screen.queryByRole('button', { name: 'Reveal in File Explorer' })).not.toBeInTheDocument()
  })

  it('uses Finder wording on macOS', async () => {
    getDesktopPlatformMock.mockReturnValue('macos')

    render(
      <FileExplorer panelTabId="files-1" directory="C:/repo" previewFile={null} previewFiles={[]} position="right" />,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'app.ts' }))
    expect(screen.getByRole('button', { name: 'Reveal in Finder' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reveal in Finder' }))
    })

    await waitFor(() => {
      expect(revealItemInDirMock).toHaveBeenCalledWith('C:/repo/src/app.ts')
    })
  })

  it('searches file names only (no content-search results)', async () => {
    // 阶段 2b：V2 没有内容搜索端点（`GET /api/fs/find` 只匹配文件名/目录名），
    // 内容搜索的 UI 分组与请求分支已整体移除 → 搜索框只剩文件名搜索。
    searchFilesMock.mockResolvedValue(['src/app.ts'])

    render(
      <FileExplorer panelTabId="files-1" directory="C:/repo" previewFile={null} previewFiles={[]} position="right" />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Search file names' }), { target: { value: 'app' } })

    // 250ms 防抖之后才发请求（真实计时器 + waitFor 等它落地）
    await waitFor(() => {
      expect(searchFilesMock).toHaveBeenCalledWith('app', expect.objectContaining({ directory: 'C:/repo', limit: 50 }))
    })

    // 命中的文件出现在「Files」分组里，点击可打开预览
    const result = await screen.findByRole('button', { name: /app\.ts/ })
    expect(result).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    // 内容匹配分组已随阶段 2b 移除
    expect(screen.queryByText('Content')).not.toBeInTheDocument()
  })
})
