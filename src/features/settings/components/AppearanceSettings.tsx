import { useState, useEffect, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import { SunIcon, MoonIcon, SystemIcon, CheckIcon } from '../../../components/Icons'
import { Toggle, SegmentedControl, SettingRow, SettingsSection } from './SettingsUI'
import { useTheme } from '../../../hooks'
import { getThemePreset } from '../../../themes'
import type { CustomCSSSnippet } from '../../../store/themeStore'
import { FONT_SCALE_MIN, FONT_SCALE_MAX } from '../../../store/themeStore'
import { saveData } from '../../../utils/downloadUtils'

// ============================================
// Theme Preset Card
// ============================================

const FALLBACK_PREVIEW_COLORS = {
  bg: '#f0f0f0',
  accent: '#888888',
  text: '#333333',
}

function toCssHsl(token: string): string {
  return `hsl(${token})`
}

function getPresetPreviewColors(id: string, resolvedTheme: 'light' | 'dark') {
  const preset = getThemePreset(id)
  if (!preset) return FALLBACK_PREVIEW_COLORS

  const colors = resolvedTheme === 'dark' ? preset.dark : preset.light
  return {
    bg: toCssHsl(colors.background.bg100),
    accent: toCssHsl(colors.accent.main100),
    text: toCssHsl(colors.text.text100),
  }
}

function getSnippetFileName(name: string): string {
  const safe = name
    .trim()
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, '-')
  return `${safe || 'custom-css'}.css`
}

function PresetCard({
  id,
  name,
  description,
  isActive,
  onClick,
  resolvedTheme,
}: {
  id: string
  name: string
  description: string
  isActive: boolean
  onClick: (e: React.MouseEvent) => void
  resolvedTheme: 'light' | 'dark'
}) {
  const colors = getPresetPreviewColors(id, resolvedTheme)
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
          <span className="text-[length:var(--fs-md)] font-medium text-text-100">{name}</span>
          {isActive && <CheckIcon size={12} className="text-accent-main-100 shrink-0" />}
        </div>
        <div className="text-[length:var(--fs-xs)] text-text-400 mt-0.5">{description}</div>
      </div>
    </button>
  )
}

// ============================================
// Font Scale Slider
// ============================================

const sliderCls = `flex-1 h-1.5 rounded-full appearance-none cursor-pointer
  bg-bg-200
  [&::-webkit-slider-thumb]:appearance-none
  [&::-webkit-slider-thumb]:w-3.5
  [&::-webkit-slider-thumb]:h-3.5
  [&::-webkit-slider-thumb]:rounded-full
  [&::-webkit-slider-thumb]:bg-accent-main-100
  [&::-webkit-slider-thumb]:shadow-sm
  [&::-webkit-slider-thumb]:border-2
  [&::-webkit-slider-thumb]:border-bg-000
  [&::-webkit-slider-thumb]:cursor-pointer
  [&::-moz-range-thumb]:w-3.5
  [&::-moz-range-thumb]:h-3.5
  [&::-moz-range-thumb]:rounded-full
  [&::-moz-range-thumb]:bg-accent-main-100
  [&::-moz-range-thumb]:border-2
  [&::-moz-range-thumb]:border-bg-000
  [&::-moz-range-thumb]:cursor-pointer
  [&::-moz-range-track]:bg-bg-200
  [&::-moz-range-track]:rounded-full
  [&::-moz-range-track]:h-1.5`

function FontScaleSlider({
  value,
  onChange,
  baseSize,
}: {
  value: number
  onChange: (v: number) => void
  /** 偏移 0 对应的基准像素值，用于显示 */
  baseSize: number
}) {
  const displayPx = baseSize + value
  return (
    <div className="flex items-center gap-3 w-full">
      <span className="text-text-400 text-[length:var(--fs-xs)] select-none shrink-0" style={{ fontSize: 11 }}>
        A
      </span>
      <input
        type="range"
        min={FONT_SCALE_MIN}
        max={FONT_SCALE_MAX}
        step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={sliderCls}
      />
      <span className="text-text-400 select-none shrink-0" style={{ fontSize: 16 }}>
        A
      </span>
      <span className="text-[length:var(--fs-sm)] text-text-300 w-12 text-right tabular-nums shrink-0">
        {displayPx}px
      </span>
    </div>
  )
}

// ============================================
// Custom CSS Editor
// ============================================

function CustomCSSEditor({
  value,
  onChange,
  onImportFile,
  onLoadTemplate,
  onClear,
  t,
}: {
  value: string
  onChange: (css: string) => void
  onImportFile: (css: string) => void
  onLoadTemplate: (css: string) => void
  onClear: () => void
  t: (key: string) => string
}) {
  const [localValue, setLocalValue] = useState(value)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleChange = (newVal: string) => {
    setLocalValue(newVal)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onChange(newVal), 400)
  }

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = event => {
      const css = event.target?.result as string
      setLocalValue(css)
      onImportFile(css)
    }
    reader.readAsText(file)
    e.target.value = ''
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
        <div className="text-[length:var(--fs-xs)] text-text-400">
          <Trans
            i18nKey="settings:appearance.customCssSpecificityHelp"
            components={{
              1: <code className="text-[length:var(--fs-xxs)] px-1 py-0.5 bg-bg-200 rounded font-mono" />,
            }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <input ref={fileInputRef} type="file" accept=".css" onChange={handleFileImport} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-[10px] text-accent-main-100 hover:text-accent-main-200 transition-colors px-1.5 py-0.5 rounded hover:bg-bg-200/50 shrink-0"
          >
            {t('appearance.importCss')}
          </button>
          {!localValue.trim() && (
            <button
              onClick={() => {
                setLocalValue(template)
                onLoadTemplate(template)
              }}
              className="text-[10px] text-accent-main-100 hover:text-accent-main-200 transition-colors px-1.5 py-0.5 rounded hover:bg-bg-200/50 shrink-0"
            >
              {t('appearance.loadTemplate')}
            </button>
          )}
        </div>
      </div>
      <textarea
        value={localValue}
        onChange={e => handleChange(e.target.value)}
        placeholder={template}
        spellCheck={false}
        className="w-full h-48 px-3 py-2 text-[length:var(--fs-sm)] font-mono bg-bg-200/50 border border-border-200 rounded-lg 
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
              onClear()
            }}
          >
            {t('common:clear')}
          </Button>
        </div>
      )}
    </div>
  )
}

function SavedSnippetItem({
  snippet,
  isActive,
  isDirty,
  onApply,
  onExport,
  onDelete,
  t,
}: {
  snippet: CustomCSSSnippet
  isActive: boolean
  isDirty: boolean
  onApply: () => void
  onExport: () => void
  onDelete: () => void
  t: (key: string) => string
}) {
  return (
    <div className="rounded-lg border border-border-200/50 px-3 py-2.5 bg-bg-100/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[length:var(--fs-sm)] font-medium text-text-100 truncate">{snippet.name}</span>
            {isActive && (
              <span className="px-1.5 py-0.5 rounded bg-accent-main-100/10 text-accent-main-100 text-[length:var(--fs-xxs)]">
                {t('appearance.activeOverride')}
              </span>
            )}
            {isDirty && (
              <span className="px-1.5 py-0.5 rounded bg-warning-bg text-warning-200 text-[length:var(--fs-xxs)]">
                {t('appearance.modifiedOverride')}
              </span>
            )}
          </div>
          <div className="text-[length:var(--fs-xs)] text-text-400 mt-1 whitespace-pre-wrap break-all max-h-10 overflow-hidden">
            {snippet.css.slice(0, 160) || '/* empty */'}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={onApply} disabled={isActive && !isDirty}>
            {isActive && !isDirty ? t('appearance.selectedOverride') : t('appearance.applyOverride')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onExport}>
            {t('common:download')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            {t('common:delete')}
          </Button>
        </div>
      </div>
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
    presetId,
    resolvedTheme,
    setPresetWithAnimation,
    availablePresets,
    customCSS,
    setCustomCSS,
    customCSSSnippets,
    activeCustomCSSSnippetId,
    saveCustomCSSSnippet,
    updateCustomCSSSnippet,
    deleteCustomCSSSnippet,
    applyCustomCSSSnippet,
    clearActiveCustomCSSSnippet,
    glassEffect,
    setGlassEffect,
    uiFontScale,
    setUIFontScale,
    codeFontScale,
    setCodeFontScale,
  } = useTheme()

  const activeSnippet = customCSSSnippets.find(item => item.id === activeCustomCSSSnippetId) || null
  const hasUnsavedSnippetChanges = activeSnippet != null && activeSnippet.css !== customCSS
  const [snippetName, setSnippetName] = useState('')

  useEffect(() => {
    setSnippetName(activeSnippet?.name ?? '')
  }, [activeSnippet?.id, activeSnippet?.name])

  const handleImportCSS = (css: string) => {
    clearActiveCustomCSSSnippet()
    setCustomCSS(css)
  }

  const handleSaveNewSnippet = () => {
    const name = snippetName.trim()
    const css = customCSS.trim()
    if (!name || !css) return
    saveCustomCSSSnippet(name, customCSS)
  }

  const handleRenameSnippet = () => {
    const name = snippetName.trim()
    if (!activeSnippet || !name || name === activeSnippet.name) return
    updateCustomCSSSnippet(activeSnippet.id, { name })
  }

  const handleUpdateSnippet = () => {
    if (!activeSnippet) return
    updateCustomCSSSnippet(activeSnippet.id, { css: customCSS })
  }

  const handleDeleteSnippet = (snippet: CustomCSSSnippet) => {
    const confirmed = window.confirm(t('appearance.deleteOverrideConfirm', { name: snippet.name }))
    if (!confirmed) return
    deleteCustomCSSSnippet(snippet.id)
  }

  const handleExportSnippet = (snippet: CustomCSSSnippet) => {
    saveData(new TextEncoder().encode(snippet.css), getSnippetFileName(snippet.name), 'text/css;charset=utf-8')
  }

  return (
    <div>
      {availablePresets.length > 0 && (
        <SettingsSection title={t('appearance.themePresets')}>
          <p className="text-[length:var(--fs-sm)] text-text-400">{t('appearance.themePresetsDesc')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {availablePresets.map(p => (
              <PresetCard
                key={p.id}
                id={p.id}
                name={p.name}
                description={p.description}
                isActive={presetId === p.id}
                onClick={e => setPresetWithAnimation(p.id, e)}
                resolvedTheme={resolvedTheme}
              />
            ))}
          </div>
        </SettingsSection>
      )}

      <SettingsSection title={t('appearance.customCss')}>
        <p className="text-[length:var(--fs-sm)] text-text-400">{t('appearance.customCssDesc')}</p>

        <div className="space-y-4">
          <CustomCSSEditor
            value={customCSS}
            onChange={setCustomCSS}
            onImportFile={handleImportCSS}
            onLoadTemplate={handleImportCSS}
            onClear={() => {
              clearActiveCustomCSSSnippet()
              setCustomCSS('')
            }}
            t={t}
          />

          <div className="rounded-lg border border-border-200/50 bg-bg-100/30 p-3 space-y-3">
            <div>
              <p className="text-[length:var(--fs-md)] text-text-100 mb-1.5">{t('appearance.savedOverrides')}</p>
              <p className="text-[length:var(--fs-sm)] text-text-400">{t('appearance.savedOverridesDesc')}</p>
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <input
                value={snippetName}
                onChange={e => setSnippetName(e.target.value)}
                placeholder={t('appearance.overrideNamePlaceholder')}
                className="flex-1 min-w-0 px-3 py-2 text-[length:var(--fs-sm)] bg-bg-200/50 border border-border-200 rounded-lg text-text-100 placeholder:text-text-500 focus:outline-none focus:border-accent-main-100/50"
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSaveNewSnippet}
                  disabled={!snippetName.trim() || !customCSS.trim()}
                >
                  {t('appearance.saveAsNewOverride')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRenameSnippet}
                  disabled={!activeSnippet || !snippetName.trim() || snippetName.trim() === activeSnippet.name}
                >
                  {t('appearance.renameOverride')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleUpdateSnippet}
                  disabled={!activeSnippet || !hasUnsavedSnippetChanges}
                >
                  {t('appearance.updateOverride')}
                </Button>
              </div>
            </div>

            {customCSSSnippets.length > 0 ? (
              <div className="space-y-2">
                {customCSSSnippets.map(snippet => (
                  <SavedSnippetItem
                    key={snippet.id}
                    snippet={snippet}
                    isActive={snippet.id === activeCustomCSSSnippetId}
                    isDirty={snippet.id === activeCustomCSSSnippetId && hasUnsavedSnippetChanges}
                    onApply={() => applyCustomCSSSnippet(snippet.id)}
                    onExport={() => handleExportSnippet(snippet)}
                    onDelete={() => handleDeleteSnippet(snippet)}
                    t={t}
                  />
                ))}
              </div>
            ) : (
              <div className="text-[length:var(--fs-sm)] text-text-500">{t('appearance.noSavedOverrides')}</div>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t('appearance.display')}>
        <div>
          <p className="text-[length:var(--fs-md)] text-text-100 mb-1.5">{t('appearance.colorMode')}</p>
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
          label={t('appearance.glassEffect')}
          description={t('appearance.glassEffectDesc')}
          onClick={() => setGlassEffect(!glassEffect)}
        >
          <Toggle enabled={glassEffect} onChange={() => setGlassEffect(!glassEffect)} />
        </SettingRow>

        <div>
          <p className="text-[length:var(--fs-md)] text-text-100 mb-2">{t('appearance.uiFontScale')}</p>
          <FontScaleSlider value={uiFontScale} onChange={setUIFontScale} baseSize={14} />
          <p className="text-[length:var(--fs-xs)] text-text-500 mt-1">{t('appearance.uiFontScaleDesc')}</p>
        </div>

        <div>
          <p className="text-[length:var(--fs-md)] text-text-100 mb-2">{t('appearance.codeFontScale')}</p>
          <FontScaleSlider value={codeFontScale} onChange={setCodeFontScale} baseSize={13} />
          <p className="text-[length:var(--fs-xs)] text-text-500 mt-1">{t('appearance.codeFontScaleDesc')}</p>
        </div>

        {(uiFontScale !== 0 || codeFontScale !== 0) && (
          <button
            onClick={() => {
              setUIFontScale(0)
              setCodeFontScale(0)
            }}
            className="text-[length:var(--fs-sm)] text-accent-main-100 hover:text-accent-main-200 transition-colors px-2 py-1 rounded hover:bg-bg-200/50 self-start"
          >
            {t('appearance.fontScaleReset')}
          </button>
        )}

        <SettingRow label={t('appearance.language')} description={t('appearance.languageDesc')}>
          <select
            value={i18n.language}
            onChange={e => i18n.changeLanguage(e.target.value)}
            className="px-2 py-1 text-[length:var(--fs-sm)] bg-bg-200/50 border border-border-200 rounded-md text-text-100 focus:outline-none focus:border-accent-main-100/50 cursor-pointer"
          >
            <option value="en">{t('appearance.languages.en')}</option>
            <option value="zh-CN">{t('appearance.languages.zh-CN')}</option>
          </select>
        </SettingRow>
      </SettingsSection>
    </div>
  )
}
