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
  setOmoConversationNavSimplifyMock,
  setAlwaysLoadFullConversationNavigationMock,
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
  setOmoConversationNavSimplifyMock: vi.fn(),
  setAlwaysLoadFullConversationNavigationMock: vi.fn(),
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
    setOmoConversationNavSimplify: setOmoConversationNavSimplifyMock,
    setAlwaysLoadFullConversationNavigation: setAlwaysLoadFullConversationNavigationMock,
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
      omoConversationNavSimplify: false,
      alwaysLoadFullConversationNavigation: false,
    })

    setSidebarShowChildSessionsMock.mockReset()
    setSidebarSubSessionSortOrderMock.mockReset()
    setSidebarFolderRecentsMock.mockReset()
    setSidebarFolderRecentsShowDiffMock.mockReset()
    setTerminalCopyOnSelectMock.mockReset()
    setTerminalRightClickPasteMock.mockReset()
    setWakeLockMock.mockReset()
    setOmoConversationNavSimplifyMock.mockReset()
    setAlwaysLoadFullConversationNavigationMock.mockReset()
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
      omoConversationNavSimplify: false,
      alwaysLoadFullConversationNavigation: false,
    })

    render(<WorkspaceSettings />)

    const ascending = screen.getByRole('tab', { name: 'appearance.subSessionSortActiveAsc' })
    const descending = screen.getByRole('tab', { name: 'appearance.subSessionSortActiveDesc' })

    expect(ascending).toHaveAttribute('aria-selected', 'false')
    expect(descending).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(ascending)

    expect(setSidebarSubSessionSortOrderMock).toHaveBeenCalledWith('activeAsc')
  })

  it('renders navigation loading row between omoConversationNavSimplify and diffStyle in the layout section', () => {
    render(<WorkspaceSettings />)

    const layoutSection = screen.getByRole('heading', { name: 'workspace.layout' }).closest('section')

    expect(layoutSection).not.toBeNull()
    expect(layoutSection).toHaveTextContent(
      /workspace\.omoConversationNavSimplify.*workspace\.alwaysLoadFullConversationNavigation.*appearance\.diffStyle/,
    )
  })

  it('calls setAlwaysLoadFullConversationNavigation(true) when the row is clicked while false', () => {
    render(<WorkspaceSettings />)

    const label = screen.getByText('workspace.alwaysLoadFullConversationNavigation')
    fireEvent.click(label)

    expect(setAlwaysLoadFullConversationNavigationMock).toHaveBeenCalledWith(true)
  })

  it('calls setAlwaysLoadFullConversationNavigation(false) when the row toggle is clicked while true', () => {
    useLayoutStoreMock.mockReturnValue({
      sidebarFolderRecents: false,
      sidebarFolderRecentsShowDiff: false,
      sidebarShowChildSessions: true,
      sidebarSubSessionSortOrder: 'activeAsc',
      terminalCopyOnSelect: false,
      terminalRightClickPaste: false,
      wakeLock: false,
      omoConversationNavSimplify: false,
      alwaysLoadFullConversationNavigation: true,
    })

    render(<WorkspaceSettings />)

    const toggle = screen.getByRole('switch', { name: 'workspace.alwaysLoadFullConversationNavigation' })

    fireEvent.click(toggle)

    expect(setAlwaysLoadFullConversationNavigationMock).toHaveBeenCalledWith(false)
  })

  it('calls setOmoConversationNavSimplify(true) when the row is clicked while false', () => {
    render(<WorkspaceSettings />)

    const label = screen.getByText('workspace.omoConversationNavSimplify')
    fireEvent.click(label)

    expect(setOmoConversationNavSimplifyMock).toHaveBeenCalledWith(true)
  })

  it('calls setOmoConversationNavSimplify(false) when the row toggle is clicked while true', () => {
    useLayoutStoreMock.mockReturnValue({
      sidebarFolderRecents: false,
      sidebarFolderRecentsShowDiff: false,
      sidebarShowChildSessions: false,
      sidebarSubSessionSortOrder: 'activeAsc',
      terminalCopyOnSelect: false,
      terminalRightClickPaste: false,
      wakeLock: false,
      omoConversationNavSimplify: true,
      alwaysLoadFullConversationNavigation: false,
    })

    render(<WorkspaceSettings />)

    const toggle = screen.getByRole('switch', { checked: true })
    fireEvent.click(toggle)

    expect(setOmoConversationNavSimplifyMock).toHaveBeenCalledWith(false)
  })

  it('calls setOmoConversationNavSimplify(false) when the toggle is clicked while true', () => {
    useLayoutStoreMock.mockReturnValue({
      sidebarFolderRecents: false,
      sidebarFolderRecentsShowDiff: false,
      sidebarShowChildSessions: true,
      sidebarSubSessionSortOrder: 'activeAsc',
      terminalCopyOnSelect: false,
      terminalRightClickPaste: false,
      wakeLock: false,
      omoConversationNavSimplify: true,
      alwaysLoadFullConversationNavigation: false,
    })

    render(<WorkspaceSettings />)

    const row = screen.getByText('workspace.omoConversationNavSimplify').closest('div[class*="cursor-pointer"]') as HTMLElement
    const toggle = row.querySelector('button[role="switch"]')
    expect(toggle).not.toBeNull()

    fireEvent.click(toggle!)

    expect(setOmoConversationNavSimplifyMock).toHaveBeenCalledWith(false)
  })
})
