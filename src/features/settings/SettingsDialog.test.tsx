import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { SettingsDialog } from './SettingsDialog'

const notificationTargets = vi.hoisted(() => ({ mode: 'both' as 'both' | 'system' | 'sound' }))

vi.mock('../../components/ui/Dialog', () => ({
  Dialog: ({ isOpen, children, ariaLabel }: { isOpen: boolean; children: React.ReactNode; ariaLabel: string }) =>
    isOpen ? (
      <div role="dialog" aria-label={ariaLabel}>
        {children}
      </div>
    ) : null,
}))
vi.mock('../../hooks', () => ({ useIsMobile: () => false }))
vi.mock('../../utils/tauri', () => ({ isTauri: () => true }))
vi.mock('./KeybindingsSection', () => ({ KeybindingsSection: () => <div>Shortcuts content</div> }))
vi.mock('./components/AgentSettings', () => ({ AgentSettings: () => <div>Agent content</div> }))
vi.mock('./components/AppearanceSettings', () => ({
  AppearanceSettings: () => (
    <div data-setting-label="Color Mode">
      <button type="button" className="hidden">
        Hidden color control
      </button>
      <button type="button">Color control</button>
    </div>
  ),
}))
vi.mock('./components/AboutSettings', () => ({ AboutSettings: () => <div>About content</div> }))
vi.mock('./components/ChatSettings', () => ({ ChatSettings: () => <div>Chat content</div> }))
vi.mock('./components/ModelsSettings', () => ({ ModelsSettings: () => <div>Models content</div> }))
vi.mock('./components/NotificationSettings', () => ({
  NotificationSettings: () => (
    <div>
      <div data-setting-label="System Notifications">
        <button type="button">System settings</button>
      </div>
      {notificationTargets.mode !== 'sound' && (
        <div data-setting-label="Session Completed" data-setting-context="Notification Types">
          <button type="button">System event control</button>
        </div>
      )}
      {notificationTargets.mode !== 'system' && (
        <div data-setting-label="Session Completed" data-setting-context="Event Sounds">
          <button type="button">Sound event control</button>
        </div>
      )}
      <div data-setting-label="Sound Settings">
        <button type="button">Sound settings</button>
      </div>
    </div>
  ),
}))
vi.mock('./components/ServiceSettings', () => ({ ServiceSettings: () => <div>Service content</div> }))
vi.mock('./components/ServersSettings', () => ({ ServersSettings: () => <div>Servers content</div> }))
vi.mock('./components/WorkspaceSettings', () => ({ WorkspaceSettings: () => <div>Workspace content</div> }))
vi.mock('./components/ConfigSettings', () => ({ ConfigSettings: () => <div>Config content</div> }))

describe('SettingsDialog search', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    notificationTargets.mode = 'both'
    vi.stubGlobal('__APP_VERSION__', 'test')
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => window.setTimeout(() => callback(0), 0))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => clearTimeout(id))
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.scrollTo = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('restores categories and jumps to a highlighted search result', async () => {
    render(<SettingsDialog isOpen onClose={vi.fn()} />)
    await act(async () => vi.advanceTimersByTime(1))

    expect(screen.getByText('Core')).toBeInTheDocument()
    expect(screen.getByText('Advanced')).toBeInTheDocument()

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Color Mode' } })
    fireEvent.click(screen.getByRole('option', { name: /Color Mode/ }))
    await act(async () => vi.advanceTimersByTime(1))

    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Color control').parentElement).toHaveClass('settings-search-highlight')
    expect(screen.getByRole('button', { name: 'Color control' })).toHaveFocus()
  })

  it('distinguishes duplicate setting labels by their subgroup', async () => {
    render(<SettingsDialog isOpen onClose={vi.fn()} />)
    await act(async () => vi.advanceTimersByTime(1))

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Session Completed' } })
    fireEvent.click(screen.getByRole('option', { name: /Session Completed.*Event Sounds/ }))
    await act(async () => vi.advanceTimersByTime(1))

    expect(screen.getByText('Sound event control').parentElement).toHaveClass('settings-search-highlight')
    expect(screen.getByRole('button', { name: 'Sound event control' })).toHaveFocus()
  })

  it.each([
    { mode: 'sound' as const, context: 'Notification Types', fallback: 'System settings' },
    { mode: 'system' as const, context: 'Event Sounds', fallback: 'Sound settings' },
  ])('uses the $context fallback when its conditional target is absent', async ({ mode, context, fallback }) => {
    notificationTargets.mode = mode
    render(<SettingsDialog isOpen onClose={vi.fn()} />)
    await act(async () => vi.advanceTimersByTime(1))

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Session Completed' } })
    fireEvent.click(screen.getByRole('option', { name: new RegExp(`Session Completed.*${context}`) }))
    await act(async () => vi.advanceTimersByTime(1))

    expect(screen.getByText(fallback).parentElement).toHaveClass('settings-search-highlight')
    expect(screen.getByRole('button', { name: fallback })).toHaveFocus()
  })

  it('cancels a pending highlight when the dialog closes', async () => {
    const { rerender } = render(<SettingsDialog isOpen onClose={vi.fn()} />)
    await act(async () => vi.advanceTimersByTime(1))
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    scrollIntoView.mockClear()

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Color Mode' } })
    fireEvent.click(screen.getByRole('option', { name: /Color Mode/ }))
    rerender(<SettingsDialog isOpen={false} onClose={vi.fn()} />)
    await act(async () => vi.advanceTimersByTime(10))

    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
