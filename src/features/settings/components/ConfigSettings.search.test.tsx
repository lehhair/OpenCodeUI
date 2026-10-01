import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { ConfigSettings } from './ConfigSettings'

const api = vi.hoisted(() => ({
  getGlobalConfig: vi.fn(),
  getConfig: vi.fn(),
  // v2：config.providers() 被 model.list() 取代；写配置改走文档写入
  getActiveModels: vi.fn(),
  writeConfigDocument: vi.fn(),
  listAvailableShells: vi.fn(),
}))

vi.mock('../../../api', () => api)
vi.mock('../../../hooks', () => ({
  useCurrentDirectory: () => 'E:/workspace',
  useIsMobile: () => false,
}))

describe('ConfigSettings search', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.getGlobalConfig.mockResolvedValue({
      // v2 的配置顶层键是 providers（复数）
      providers: {
        openai: {
          options: { baseURL: 'https://gateway.example.com' },
        },
      },
    })
    api.getConfig.mockResolvedValue({})
    api.getActiveModels.mockResolvedValue([])
    api.writeConfigDocument.mockResolvedValue('/repo/opencode.json')
    api.listAvailableShells.mockResolvedValue([])
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.scrollTo = vi.fn()
  })

  // 阻塞：与 configEditorDrill 的 provider 用例同因——v2 的配置顶层键是
  // `providers`（复数），而配置编辑器（ProvidersSection / configEditorValidation /
  // 搜索索引）仍按 v1 的 `provider` 读取，因此搜不到 providers 下的字段。
  // 待把该组顶层键改成 `providers` 后再启用（夹具已改为复数）。
  it('searches a raw JSON value and opens its nested field', async () => {
    render(<ConfigSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Config Editor' }))
    await screen.findByRole('dialog', { name: 'Config Editor' })

    const input = screen.getByRole('combobox', { name: 'Search config fields...' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'gateway.example.com' } })
    const result = await screen.findByRole('option', { name: /providers\.openai\.options\.baseURL/ })
    fireEvent.click(result)

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Providers & Models' })).toHaveAttribute('aria-selected', 'true'))
    const field = await screen.findByDisplayValue('https://gateway.example.com')
    await waitFor(() => expect(field.closest('[data-config-field]')).toHaveClass('settings-search-highlight'))
    expect(field).toHaveFocus()
    // 单跑 0.5s 就过；但本文件要挂载完整 ConfigSettings + 配置编辑器弹窗（jsdom 冷启动最重的路径之一），
    // 全量并发下会超出 5s 默认值误报。给足时间，避免「新增任何测试文件就把它压崩」。
  }, 20000)
})
