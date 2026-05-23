import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSettings } from './WorkspaceSettings'

const {
  useTranslationMock,
  useThemeMock,
  useLayoutStoreMock,
  setSidebarShowChildSessionsMock,
  setSidebarSubSessionSortOrderMock,
  setSidebarFolderRecentsMock,
  setSidebarFolderRecentsShowDiffMock,
  setTerminalCopyOnSelectMock,
  setTerminalRightClickPasteMock,
  setWakeLockMock,
  syncTerminalTitleModeMock,
} = vi.hoisted(() => ({
  useTranslationMock: vi.fn(),
  useThemeMock: vi.fn(),
  useLayoutStoreMock: vi.fn(),
  setSidebarShowChildSessionsMock: vi.fn(),
  setSidebarSubSessionSortOrderMock: vi.fn(),
  setSidebarFolderRecentsMock: vi.fn(),
  setSidebarFolderRecentsShowDiffMock: vi.fn(),
  setTerminalCopyOnSelectMock: vi.fn(),
  setTerminalRightClickPasteMock: vi.fn(),
  setWakeLockMock: vi.fn(),
  syncTerminalTitleModeMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: useTranslationMock,
}))

vi.mock('../../../hooks', () => ({
  useTheme: useThemeMock,
}))

vi.mock('../../../store', () => ({
  layoutStore: {
    setSidebarFolderRecents: setSidebarFolderRecentsMock,
    setSidebarFolderRecentsShowDiff: setSidebarFolderRecentsShowDiffMock,
    setSidebarShowChildSessions: setSidebarShowChildSessionsMock,
    setSidebarSubSessionSortOrder: setSidebarSubSessionSortOrderMock,
    setTerminalCopyOnSelect: setTerminalCopyOnSelectMock,
    setTerminalRightClickPaste: setTerminalRightClickPasteMock,
    setWakeLock: setWakeLockMock,
    syncTerminalTitleMode: syncTerminalTitleModeMock,
  },
  useLayoutStore: useLayoutStoreMock,
}))

describe('WorkspaceSettings', () => {
  beforeEach(() => {
    useTranslationMock.mockReturnValue({
      t: (key: string) => key,
    })

    useThemeMock.mockReturnValue({
      isWideMode: false,
      toggleWideMode: vi.fn(),
      diffStyle: 'markers',
      setDiffStyle: vi.fn(),
      codeWordWrap: false,
      setCodeWordWrap: vi.fn(),
      manualTerminalTitles: false,
      setManualTerminalTitles: vi.fn(),
    })

    useLayoutStoreMock.mockReturnValue({
      sidebarFolderRecents: false,
      sidebarFolderRecentsShowDiff: false,
      sidebarShowChildSessions: true,
      sidebarSubSessionSortOrder: 'activeAsc',
      terminalCopyOnSelect: false,
      terminalRightClickPaste: false,
      wakeLock: false,
    })

    setSidebarShowChildSessionsMock.mockReset()
    setSidebarSubSessionSortOrderMock.mockReset()
    setSidebarFolderRecentsMock.mockReset()
    setSidebarFolderRecentsShowDiffMock.mockReset()
    setTerminalCopyOnSelectMock.mockReset()
    setTerminalRightClickPasteMock.mockReset()
    setWakeLockMock.mockReset()
    syncTerminalTitleModeMock.mockReset()
  })

  it('renders sub-session sort immediately after show-child-sessions in the workspace sidebar section', () => {
    render(<WorkspaceSettings />)

    const sidebarSection = screen.getByRole('heading', { name: 'workspace.sidebar' }).closest('section')

    expect(sidebarSection).not.toBeNull()
    expect(sidebarSection).toHaveTextContent(
      /appearance\.showChildSessions.*appearance\.showChildSessionsDesc.*appearance\.subSessionSort/,
    )
  })

  it('reflects the selected sort order and sets descending when clicked', () => {
    render(<WorkspaceSettings />)

    const ascending = screen.getByRole('tab', { name: 'appearance.subSessionSortActiveAsc' })
    const descending = screen.getByRole('tab', { name: 'appearance.subSessionSortActiveDesc' })

    expect(ascending).toHaveAttribute('aria-selected', 'true')
    expect(descending).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(descending)

    expect(setSidebarSubSessionSortOrderMock).toHaveBeenCalledWith('activeDesc')
  })

  it('sets ascending when the ascending option is clicked', () => {
    useLayoutStoreMock.mockReturnValue({
      sidebarFolderRecents: false,
      sidebarFolderRecentsShowDiff: false,
      sidebarShowChildSessions: true,
      sidebarSubSessionSortOrder: 'activeDesc',
      terminalCopyOnSelect: false,
      terminalRightClickPaste: false,
      wakeLock: false,
    })

    render(<WorkspaceSettings />)

    const ascending = screen.getByRole('tab', { name: 'appearance.subSessionSortActiveAsc' })
    const descending = screen.getByRole('tab', { name: 'appearance.subSessionSortActiveDesc' })

    expect(ascending).toHaveAttribute('aria-selected', 'false')
    expect(descending).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(ascending)

    expect(setSidebarSubSessionSortOrderMock).toHaveBeenCalledWith('activeAsc')
  })
})
