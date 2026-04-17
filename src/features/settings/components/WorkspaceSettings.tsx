import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks'
import { layoutStore, useLayoutStore } from '../../../store'
import { Toggle, SegmentedControl, SettingRow, SettingsSection } from './SettingsUI'

export function WorkspaceSettings() {
  const { t } = useTranslation(['settings'])
  const { isWideMode, toggleWideMode, diffStyle, setDiffStyle, codeWordWrap, setCodeWordWrap } = useTheme()
  const { sidebarFolderRecents, sidebarFolderRecentsShowDiff, sidebarShowChildSessions, wakeLock } = useLayoutStore()

  return (
    <div>
      <SettingsSection title={t('workspace.layout')}>
        <p className="text-[length:var(--fs-sm)] text-text-400">{t('workspace.layoutDesc')}</p>

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

        <div>
          <p className="text-[length:var(--fs-md)] text-text-100 mb-1.5">{t('appearance.diffStyle')}</p>
          <p className="text-[length:var(--fs-sm)] text-text-400 mb-3">{t('appearance.diffStyleDesc')}</p>
          <SegmentedControl
            value={diffStyle}
            options={[
              { value: 'markers', label: t('appearance.diffStyleMarkers') },
              { value: 'changeBars', label: t('appearance.diffStyleChangeBars') },
            ]}
            onChange={v => setDiffStyle(v as 'markers' | 'changeBars')}
          />
        </div>
      </SettingsSection>

      <SettingsSection title={t('workspace.sidebar')}>
        <p className="text-[length:var(--fs-sm)] text-text-400">{t('workspace.sidebarDesc')}</p>

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
