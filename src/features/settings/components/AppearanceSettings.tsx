import { useState, useEffect, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { SunIcon, MoonIcon, SystemIcon, CheckIcon } from '../../../components/Icons'
import { Toggle, SegmentedControl, SettingRow, SettingsSection } from './SettingsUI'
import { useTheme } from '../../../hooks'
import { layoutStore, useLayoutStore } from '../../../store'

// ============================================
// Theme Preset Card
// ============================================

const PRESET_PREVIEW_COLORS: Record<string, { bg: string; accent: string; text: string }> = {
  eucalyptus: { bg: '#f0f3f0', accent: '#4d9e82', text: '#1e2e28' },
  claude: { bg: '#f3f0eb', accent: '#e87c2a', text: '#2d2a26' },
  breeze: { bg: '#f3f5f7', accent: '#2ba5a5', text: '#212d36' },
  custom: { bg: '#f0f0f0', accent: '#888888', text: '#333333' },
}

function PresetCard({
  id,
  name,
  description,
  isActive,
  onClick,
}: {
  id: string
  name: string
  description: string
  isActive: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  const colors = PRESET_PREVIEW_COLORS[id] || PRESET_PREVIEW_COLORS.custom
  return (
    <button
      onClick={onClick}
      className={`flex items-start gap-3 p-3 rounded-lg border transition-all text-left w-full
        ${
          isActive
            ? 'border-accent-main-100/60 bg-accent-main-100/5 ring-1 ring-accent-main-100/20'
            : 'border-border-200/50 hover:border-border-300 hover:bg-bg-100/50'
        }`}
    >
      <div
        className="shrink-0 w-8 h-8 rounded-md border border-border-200/30 overflow-hidden relative mt-0.5"
        style={{ backgroundColor: colors.bg }}
      >
        <div className="absolute bottom-0 left-0 right-0 h-2" style={{ backgroundColor: colors.accent }} />
        <div
          className="absolute top-1.5 left-1.5 w-3 h-0.5 rounded-full"
          style={{ backgroundColor: colors.text, opacity: 0.6 }}
        />
        <div
          className="absolute top-3 left-1.5 w-2 h-0.5 rounded-full"
          style={{ backgroundColor: colors.text, opacity: 0.3 }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-text-100">{name}</span>
          {isActive && <CheckIcon size={12} className="text-accent-main-100 shrink-0" />}
        </div>
        <div className="text-[11px] text-text-400 mt-0.5">{description}</div>
      </div>
    </button>
  )
}

// ============================================
// Custom CSS Editor
// ============================================

function CustomCSSEditor({
  value,
  onChange,
  t,
}: {
  value: string
  onChange: (css: string) => void
  t: (key: string) => string
}) {
  const [localValue, setLocalValue] = useState(value)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleChange = (newVal: string) => {
    setLocalValue(newVal)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onChange(newVal), 400)
  }

  const template = `/* ====== One Dark Inspired Theme Template ====== */
/* Palette inspired by Atom One Dark / One Dark Pro (MIT). */
/* Use HSL token values: H S% L% (without hsl()). */

/* Optional font imports (must stay at top if enabled) */
/* @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap'); */

/* ====== Fonts ====== */
:root:root {
  --font-ui-sans: 'Inter', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace;
}

/* ====== Light (default + manual light) ====== */
:root:root,
:root:root[data-mode='light'] {
  /* Background */
  --bg-000: 220 30% 99%;
  --bg-100: 220 25% 96%;
  --bg-200: 220 20% 92%;
  --bg-300: 220 16% 88%;
  --bg-400: 220 14% 82%;

  /* Text */
  --text-000: 0 0% 100%;
  --text-100: 220 16% 17%;
  --text-200: 220 12% 35%;
  --text-300: 220 10% 50%;
  --text-400: 220 8% 62%;
  --text-500: 220 7% 72%;
  --text-600: 220 10% 84%;

  /* Accent */
  --accent-brand: 286 50% 52%;
  --accent-main-000: 207 70% 46%;
  --accent-main-100: 207 78% 54%;
  --accent-main-200: 207 86% 62%;
  --accent-secondary-100: 187 50% 43%;

  /* Semantic */
  --success-100: 95 36% 42%;
  --success-200: 95 30% 34%;
  --success-bg: 95 45% 93%;
  --warning-100: 37 84% 46%;
  --warning-200: 37 76% 39%;
  --warning-bg: 37 90% 92%;
  --danger-000: 355 58% 42%;
  --danger-100: 355 68% 54%;
  --danger-200: 355 74% 63%;
  --danger-bg: 355 80% 94%;
  --danger-900: 355 54% 91%;
  --info-100: 221 74% 50%;
  --info-200: 221 78% 60%;
  --info-bg: 221 85% 94%;

  /* Border */
  --border-100: 220 16% 84%;
  --border-200: 220 13% 79%;
  --border-300: 220 12% 70%;

  /* Special */
  --always-black: 0 0% 0%;
  --always-white: 0 0% 100%;
  --oncolor-100: 0 0% 100%;
}

/* ====== Dark (manual dark) ====== */
:root:root[data-mode='dark'] {
  /* Background */
  --bg-000: 220 13% 21%;
  --bg-100: 220 14% 18%;
  --bg-200: 220 15% 15%;
  --bg-300: 220 16% 12%;
  --bg-400: 220 18% 9%;

  /* Text */
  --text-000: 0 0% 100%;
  --text-100: 220 14% 90%;
  --text-200: 220 12% 72%;
  --text-300: 220 10% 58%;
  --text-400: 220 9% 46%;
  --text-500: 220 8% 36%;
  --text-600: 220 10% 26%;

  /* Accent */
  --accent-brand: 286 56% 67%;
  --accent-main-000: 207 70% 58%;
  --accent-main-100: 207 82% 66%;
  --accent-main-200: 207 90% 74%;
  --accent-secondary-100: 187 47% 55%;

  /* Semantic */
  --success-100: 95 38% 62%;
  --success-200: 95 33% 52%;
  --success-bg: 95 25% 18%;
  --warning-100: 37 87% 63%;
  --warning-200: 37 76% 54%;
  --warning-bg: 37 30% 18%;
  --danger-000: 355 63% 60%;
  --danger-100: 355 74% 66%;
  --danger-200: 355 80% 74%;
  --danger-bg: 355 28% 18%;
  --danger-900: 355 24% 26%;
  --info-100: 221 83% 65%;
  --info-200: 221 88% 74%;
  --info-bg: 221 30% 18%;

  /* Border */
  --border-100: 220 12% 28%;
  --border-200: 220 12% 34%;
  --border-300: 220 12% 42%;

  /* Special */
  --always-black: 0 0% 0%;
  --always-white: 0 0% 100%;
  --oncolor-100: 0 0% 100%;
}

/* ====== Auto (system dark when data-mode is not set) ====== */
@media (prefers-color-scheme: dark) {
  :root:root:not([data-mode]) {
    --bg-000: 220 13% 21%;
    --bg-100: 220 14% 18%;
    --bg-200: 220 15% 15%;
    --bg-300: 220 16% 12%;
    --bg-400: 220 18% 9%;

    --text-000: 0 0% 100%;
    --text-100: 220 14% 90%;
    --text-200: 220 12% 72%;
    --text-300: 220 10% 58%;
    --text-400: 220 9% 46%;
    --text-500: 220 8% 36%;
    --text-600: 220 10% 26%;

    --accent-brand: 286 56% 67%;
    --accent-main-000: 207 70% 58%;
    --accent-main-100: 207 82% 66%;
    --accent-main-200: 207 90% 74%;
    --accent-secondary-100: 187 47% 55%;

    --success-100: 95 38% 62%;
    --success-200: 95 33% 52%;
    --success-bg: 95 25% 18%;
    --warning-100: 37 87% 63%;
    --warning-200: 37 76% 54%;
    --warning-bg: 37 30% 18%;
    --danger-000: 355 63% 60%;
    --danger-100: 355 74% 66%;
    --danger-200: 355 80% 74%;
    --danger-bg: 355 28% 18%;
    --danger-900: 355 24% 26%;
    --info-100: 221 83% 65%;
    --info-200: 221 88% 74%;
    --info-bg: 221 30% 18%;

    --border-100: 220 12% 28%;
    --border-200: 220 12% 34%;
    --border-300: 220 12% 42%;

    --always-black: 0 0% 0%;
    --always-white: 0 0% 100%;
    --oncolor-100: 0 0% 100%;
  }
}`

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-text-400">
          <Trans
            i18nKey="settings:appearance.customCssSpecificityHelp"
            components={{
              1: <code className="text-[10px] px-1 py-0.5 bg-bg-200 rounded font-mono" />,
            }}
          />
        </div>
        {!localValue.trim() && (
          <button
            onClick={() => handleChange(template)}
            className="text-[10px] text-accent-main-100 hover:text-accent-main-200 transition-colors px-1.5 py-0.5 rounded hover:bg-bg-200/50 shrink-0"
          >
            {t('appearance.loadTemplate')}
          </button>
        )}
      </div>
      <textarea
        value={localValue}
        onChange={e => handleChange(e.target.value)}
        placeholder={template}
        spellCheck={false}
        className="w-full h-48 px-3 py-2 text-[12px] font-mono bg-bg-200/50 border border-border-200 rounded-lg 
          focus:outline-none focus:border-accent-main-100/50 text-text-100 placeholder:text-text-500 
          resize-y custom-scrollbar leading-relaxed"
      />
      {localValue.trim() && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLocalValue('')
              onChange('')
            }}
          >
            {t('common:clear')}
          </Button>
        </div>
      )}
    </div>
  )
}

// ============================================
// Tab: Appearance
// ============================================

export function AppearanceSettings() {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const {
    mode: themeMode,
    setThemeWithAnimation,
    isWideMode,
    toggleWideMode,
    presetId,
    setPresetWithAnimation,
    availablePresets,
    customCSS,
    setCustomCSS,
    diffStyle,
    setDiffStyle,
    codeWordWrap,
    setCodeWordWrap,
    glassEffect,
    setGlassEffect,
  } = useTheme()
  const { sidebarFolderRecents, sidebarFolderRecentsShowDiff, sidebarShowChildSessions, wakeLock } = useLayoutStore()

  return (
    <div>
      {availablePresets.length > 0 && (
        <SettingsSection title={t('appearance.themePresets')}>
          <p className="text-[12px] text-text-400">{t('appearance.themePresetsDesc')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {availablePresets.map(p => (
              <PresetCard
                key={p.id}
                id={p.id}
                name={p.name}
                description={p.description}
                isActive={presetId === p.id}
                onClick={e => setPresetWithAnimation(p.id, e)}
              />
            ))}
          </div>
        </SettingsSection>
      )}

      <SettingsSection title={t('appearance.customCss')}>
        <p className="text-[12px] text-text-400">{t('appearance.customCssDesc')}</p>
        <CustomCSSEditor value={customCSS} onChange={setCustomCSS} t={t} />
      </SettingsSection>

      <SettingsSection title={t('appearance.display')}>
        <div>
          <p className="text-[13px] text-text-100 mb-1.5">{t('appearance.colorMode')}</p>
          <SegmentedControl
            value={themeMode}
            options={[
              { value: 'system', label: t('appearance.modeAuto'), icon: <SystemIcon size={14} /> },
              { value: 'light', label: t('appearance.modeLight'), icon: <SunIcon size={14} /> },
              { value: 'dark', label: t('appearance.modeDark'), icon: <MoonIcon size={14} /> },
            ]}
            onChange={(v, e) => setThemeWithAnimation(v, e)}
          />
        </div>

        <SettingRow
          label={t('appearance.wideMode')}
          description={t('appearance.wideModeDesc')}
          onClick={toggleWideMode}
        >
          <Toggle enabled={isWideMode} onChange={toggleWideMode} />
        </SettingRow>

        <SettingRow
          label={t('appearance.glassEffect')}
          description={t('appearance.glassEffectDesc')}
          onClick={() => setGlassEffect(!glassEffect)}
        >
          <Toggle enabled={glassEffect} onChange={() => setGlassEffect(!glassEffect)} />
        </SettingRow>

        <SettingRow
          label={t('appearance.codeWordWrap')}
          description={t('appearance.codeWordWrapDesc')}
          onClick={() => setCodeWordWrap(!codeWordWrap)}
        >
          <Toggle enabled={codeWordWrap} onChange={() => setCodeWordWrap(!codeWordWrap)} />
        </SettingRow>

        <SettingRow
          label={t('appearance.wakeLock')}
          description={t('appearance.wakeLockDesc')}
          onClick={() => layoutStore.setWakeLock(!wakeLock)}
        >
          <Toggle enabled={wakeLock} onChange={() => layoutStore.setWakeLock(!wakeLock)} />
        </SettingRow>

        <div>
          <p className="text-[13px] text-text-100 mb-1.5">{t('appearance.diffStyle')}</p>
          <SegmentedControl
            value={diffStyle}
            options={[
              { value: 'markers', label: t('appearance.diffStyleMarkers') },
              { value: 'changeBars', label: t('appearance.diffStyleChangeBars') },
            ]}
            onChange={v => setDiffStyle(v as 'markers' | 'changeBars')}
          />
          <p className="text-[11px] text-text-500 mt-1">{t('appearance.diffStyleDesc')}</p>
        </div>

        <SettingRow label={t('appearance.language')} description={t('appearance.languageDesc')}>
          <select
            value={i18n.language}
            onChange={e => i18n.changeLanguage(e.target.value)}
            className="px-2 py-1 text-[12px] bg-bg-200/50 border border-border-200 rounded-md text-text-100 focus:outline-none focus:border-accent-main-100/50 cursor-pointer"
          >
            <option value="en">{t('appearance.languages.en')}</option>
            <option value="zh-CN">{t('appearance.languages.zh-CN')}</option>
          </select>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('appearance.sidebar')}>
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
