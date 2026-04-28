import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DesktopTitlebar } from './DesktopTitlebar'

const { useThemeMock, useUpdateStoreMock, hasUpdateAvailableMock, getDesktopPlatformMock, usesCustomDesktopTitlebarMock } =
  vi.hoisted(() => ({
    useThemeMock: vi.fn(() => ({ mode: 'dark', resolvedTheme: 'dark' })),
    useUpdateStoreMock: vi.fn(() => ({})),
    hasUpdateAvailableMock: vi.fn(() => false),
    getDesktopPlatformMock: vi.fn(() => 'windows'),
    usesCustomDesktopTitlebarMock: vi.fn(() => true),
  }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../hooks/useTheme', () => ({
  useTheme: () => useThemeMock(),
}))

vi.mock('../store/updateStore', () => ({
  useUpdateStore: () => useUpdateStoreMock(),
  hasUpdateAvailable: () => hasUpdateAvailableMock(),
}))

vi.mock('../utils/tauri', () => ({
  isTauri: () => false,
  getDesktopPlatform: () => getDesktopPlatformMock(),
  usesCustomDesktopTitlebar: () => usesCustomDesktopTitlebarMock(),
}))

describe('DesktopTitlebar', () => {
  it('preserves externally injected window controls across rerenders', () => {
    const { rerender } = render(<DesktopTitlebar />)

    const controlsHost = document.querySelector('[data-tauri-decorum-tb]') as HTMLDivElement | null
    expect(controlsHost).not.toBeNull()

    const injectedControl = document.createElement('button')
    injectedControl.textContent = 'Minimize'
    controlsHost!.appendChild(injectedControl)

    rerender(<DesktopTitlebar />)

    expect(screen.getByText('Minimize')).toBeInTheDocument()
  })
})
