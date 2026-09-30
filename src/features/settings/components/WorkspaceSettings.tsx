import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks'
import { layoutStore, useLayoutStore } from '../../../store'
import { Toggle, SegmentedControl, SettingRow, SettingField, SettingsSection } from './SettingsUI'

export function WorkspaceSettings() {
  const { t } = useTranslation(['settings'])
  const {
    isWideMode,
    toggleWideMode,
    diffStyle,
    setDiffStyle,
    codeWordWrap,
    setCodeWordWrap,
    manualTerminalTitles,
    setManualTerminalTitles,
  } = useTheme()
  const {
    sidebarFolderRecents,
    sidebarFolderRecentsShowDiff,
    sidebarShowChildSessions,
    terminalCopyOnSelect,
    terminalRightClickPaste,
    wakeLock,
  } = useLayoutStore()

  const toggleManualTerminalTitles = () => {
    const next = !manualTerminalTitles
    setManualTerminalTitles(next)
    layoutStore.syncTerminalTitleMode(next)
  }

  return (
    <div>
      <SettingsSection title={t('workspace.layout')} description={t('workspace.layoutDesc')}>
        <SettingRow
          label={t('appearance.wideMode')}
          description={t('appearance.wideModeDesc')}
          onClick={toggleWideMode}
        >
          <Toggle enabled={isWideMode} onChange={toggleWideMode} />
        </SettingRow>

        <SettingRow
          label={t('appearance.wakeLock')}
          description={t('appearance.wakeLockDesc')}
          onClick={() => layoutStore.setWakeLock(!wakeLock)}
        >
          <Toggle enabled={wakeLock} onChange={() => layoutStore.setWakeLock(!wakeLock)} />
        </SettingRow>

        <SettingRow
          label={t('appearance.codeWordWrap')}
          description={t('appearance.codeWordWrapDesc')}
          onClick={() => setCodeWordWrap(!codeWordWrap)}
        >
          <Toggle enabled={codeWordWrap} onChange={() => setCodeWordWrap(!codeWordWrap)} />
        </SettingRow>

        <SettingRow
          label={t('workspace.manualTerminalTitles')}
          description={t('workspace.manualTerminalTitlesDesc')}
          onClick={toggleManualTerminalTitles}
        >
          <Toggle enabled={manualTerminalTitles} onChange={toggleManualTerminalTitles} />
        </SettingRow>

        <SettingField label={t('appearance.diffStyle')} description={t('appearance.diffStyleDesc')}>
          <div className="w-full max-w-[300px]">
            <SegmentedControl
              value={diffStyle}
              options={[
                { value: 'markers', label: t('appearance.diffStyleMarkers') },
                { value: 'changeBars', label: t('appearance.diffStyleChangeBars') },
              ]}
              onChange={v => setDiffStyle(v as 'markers' | 'changeBars')}
            />
          </div>
        </SettingField>
      </SettingsSection>

      <SettingsSection title={t('workspace.terminal')} description={t('workspace.terminalDesc')}>
        <SettingRow
          label={t('workspace.terminalCopyOnSelect')}
          description={t('workspace.terminalCopyOnSelectDesc')}
          onClick={() => layoutStore.setTerminalCopyOnSelect(!terminalCopyOnSelect)}
        >
          <Toggle
            enabled={terminalCopyOnSelect}
            onChange={() => layoutStore.setTerminalCopyOnSelect(!terminalCopyOnSelect)}
          />
        </SettingRow>

        <SettingRow
          label={t('workspace.terminalRightClickPaste')}
          description={t('workspace.terminalRightClickPasteDesc')}
          onClick={() => layoutStore.setTerminalRightClickPaste(!terminalRightClickPaste)}
        >
          <Toggle
            enabled={terminalRightClickPaste}
            onChange={() => layoutStore.setTerminalRightClickPaste(!terminalRightClickPaste)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('workspace.sidebar')} description={t('workspace.sidebarDesc')}>
        <SettingRow
          label={t('appearance.folderStyleRecents')}
          description={t('appearance.folderStyleRecentsDesc')}
          onClick={() => layoutStore.setSidebarFolderRecents(!sidebarFolderRecents)}
        >
          <Toggle
            enabled={sidebarFolderRecents}
            onChange={() => layoutStore.setSidebarFolderRecents(!sidebarFolderRecents)}
          />
        </SettingRow>

        <SettingRow
          label={t('appearance.folderStyleRecentsShowDiff')}
          description={t('appearance.folderStyleRecentsShowDiffDesc')}
          onClick={() => layoutStore.setSidebarFolderRecentsShowDiff(!sidebarFolderRecentsShowDiff)}
        >
          <Toggle
            enabled={sidebarFolderRecentsShowDiff}
            onChange={() => layoutStore.setSidebarFolderRecentsShowDiff(!sidebarFolderRecentsShowDiff)}
          />
        </SettingRow>

        <SettingRow
          label={t('appearance.showChildSessions')}
          description={t('appearance.showChildSessionsDesc')}
          onClick={() => layoutStore.setSidebarShowChildSessions(!sidebarShowChildSessions)}
        >
          <Toggle
            enabled={sidebarShowChildSessions}
            onChange={() => layoutStore.setSidebarShowChildSessions(!sidebarShowChildSessions)}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  )
}
