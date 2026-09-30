import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { ConfigSettings } from './ConfigSettings'

const api = vi.hoisted(() => ({
  getGlobalConfig: vi.fn(),
  getConfig: vi.fn(),
  listAvailableShells: vi.fn(),
  updateGlobalConfig: vi.fn(),
}))

vi.mock('../../../api', () => api)
vi.mock('../../../hooks', () => ({
  useCurrentDirectory: () => 'E:/workspace',
}))

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function mockClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

async function openViewer() {
  render(<ConfigSettings />)
  fireEvent.click(screen.getByRole('button', { name: 'Open Config Viewer' }))
  return screen.findByRole('dialog', { name: 'Config Viewer' })
}

describe('ConfigSettings（V2 只读降级）', () => {
  const writeText = vi.fn()

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.getGlobalConfig.mockResolvedValue({ shell: 'bash' })
    api.getConfig.mockResolvedValue({ model: 'anthropic/claude-sonnet-4', shell: 'bash' })
    api.listAvailableShells.mockResolvedValue([
      { path: '/bin/bash', name: 'bash', acceptable: true },
      { path: '/bin/zsh', name: 'zsh', acceptable: true },
    ])
    api.updateGlobalConfig.mockResolvedValue({ shell: 'zsh' })
    writeText.mockReset()
    writeText.mockResolvedValue(undefined)
    mockClipboard(writeText)
  })

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
    else Reflect.deleteProperty(navigator, 'clipboard')
    vi.clearAllMocks()
  })

  it('只保留 shell 编辑入口，不再有「保存全部 / 重置」', async () => {
    await openViewer()

    expect(screen.getByText(/only shell stays editable here/i)).toBeInTheDocument()
    expect(screen.getByText(/normalized effective config from GET \/api\/config/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save shell' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /save all/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^reset$/i })).not.toBeInTheDocument()
  })

  it('保存 shell 时只提交 { shell }，并回读服务端落地的值', async () => {
    await openViewer()

    fireEvent.change(screen.getByLabelText('shell'), { target: { value: 'zsh' } })
    const save = screen.getByRole('button', { name: 'Save shell' })
    await waitFor(() => expect(save).toBeEnabled())

    // 模拟真实服务端：写入之后 `GET /api/config` 才会返回新值
    // （⚠️ 真实服务端还有个约 1 秒的 watcher 滞后 —— 组件用 readGlobalShellSettled() 重试兜住）
    api.updateGlobalConfig.mockImplementation(async () => {
      api.getGlobalConfig.mockResolvedValue({ shell: 'zsh' })
      return { shell: 'zsh' }
    })

    fireEvent.click(save)

    await waitFor(() => expect(api.updateGlobalConfig).toHaveBeenCalledTimes(1))
    expect(api.updateGlobalConfig).toHaveBeenCalledWith({ shell: 'zsh' })
    // 保存后回读，确认服务端落地的值
    expect(api.getGlobalConfig).toHaveBeenCalled()
    await screen.findByText('Saved')
  })

  it('服务端 watcher 滞后时：重试到期望值，不会把下拉框回滚成旧值', async () => {
    await openViewer()

    fireEvent.change(screen.getByLabelText('shell'), { target: { value: 'zsh' } })
    const save = screen.getByRole('button', { name: 'Save shell' })
    await waitFor(() => expect(save).toBeEnabled())

    // 前两次回读仍是旧值（模拟 watcher 滞后），第三次才是新值
    let reads = 0
    api.updateGlobalConfig.mockResolvedValue({ shell: 'zsh' })
    api.getGlobalConfig.mockImplementation(async () => {
      reads += 1
      return { shell: reads <= 2 ? 'bash' : 'zsh' }
    })

    fireEvent.click(save)

    await screen.findByText('Saved', undefined, { timeout: 5000 })
    // 关键：最终展示的是**新值**，没有被旧值覆盖
    expect(screen.getByLabelText('shell')).toHaveValue('zsh')
    expect(reads).toBeGreaterThanOrEqual(3)
  }, 10000)

  it('每个区块与整份配置都能复制 JSON', async () => {
    await openViewer()

    const blockCopyButtons = await screen.findAllByRole('button', { name: 'Copy JSON' })
    expect(blockCopyButtons).toHaveLength(2)
    fireEvent.click(blockCopyButtons[0])
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual({ model: 'anthropic/claude-sonnet-4' })

    fireEvent.click(screen.getByRole('button', { name: 'Copy all JSON' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(JSON.parse(writeText.mock.calls[1][0])).toEqual({
      model: 'anthropic/claude-sonnet-4',
      shell: 'bash',
    })
  })
})
