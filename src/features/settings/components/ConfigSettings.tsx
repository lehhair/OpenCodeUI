// ============================================
// ConfigSettings —— opencode.json 配置「只读查看 + shell 编辑」界面
//
// 🔴 阶段 3b 降级背景（V2 迁移）：
//   V2 的配置写入入口严重缩水 —— `PATCH /api/experimental/config` 的 payload 是
//   `Config.Patch`，而它**只有 `shell` 一个字段**（packages/schema/src/config.ts:112）。
//   传其它字段会被服务端**静默丢弃**（返回成功但不生效），比报错更害人。
//   同时 `GET /api/config` 返回的是 schema **归一化后的文档数组**（未知字段被丢弃），
//   属于**有损视图**，不能当作「用户配置文件的完整内容」回写。
//
// 因此本界面只做三件事：
//   1. 只读展示归一化后的生效配置（来源见界面上方的说明）；
//   2. 只允许图形化编辑 **shell** 这一项（走 updateGlobalConfig → PATCH /api/experimental/config）；
//   3. 每个配置区块 + 整份配置都提供「复制 JSON」，引导用户粘贴到 opencode.json 保存。
//
// ⚠️ 刻意不保留任何「保存其它字段」的按钮 —— 那会静默失效。
// ============================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  SettingsIcon,
} from '../../../components/Icons'
import { Dialog } from '../../../components/ui/Dialog'
import { getConfig, getGlobalConfig, listAvailableShells, updateGlobalConfig } from '../../../api'
import type { Config } from '../../../types/api/config'
import { useCurrentDirectory } from '../../../hooks'
import { SettingsSection, settingsFieldClass } from './SettingsUI'
import { clipboardErrorHandler, copyTextToClipboard } from '../../../utils'

type JsonRecord = Record<string, unknown>

/** shell 下拉选项（本地定义，避免依赖已删除的配置编辑器类型） */
type ShellOption = { value: string; label: string; hint?: string; disabled?: boolean }

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

/** 统一用两空格缩进序列化，保证「界面看到的」与「复制的」完全一致 */
function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value)
}

/**
 * 复制 JSON 按钮
 * - 复用项目统一的 copyTextToClipboard（浏览器 Clipboard API + execCommand 兜底，Tauri 下同样可用）
 * - 复制成功后 2 秒内显示「已复制」
 */
function CopyJsonButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(text)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      clipboardErrorHandler('copy config json', error)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      title={label}
      className={`inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[length:var(--fs-xs)] transition-colors ${
        copied ? 'text-success-100' : 'text-text-300 hover:bg-bg-200/60 hover:text-text-100'
      }`}
    >
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      {copied ? copiedLabel : label}
    </button>
  )
}

/**
 * 单个顶层配置区块（只读）
 * 复制的内容是 `{ "<字段名>": ... }` 片段，可直接粘贴进 opencode.json。
 */
function ConfigJsonBlock({ name, value }: { name: string; value: unknown }) {
  const { t } = useTranslation('settings')
  const [expanded, setExpanded] = useState(false)
  const json = useMemo(() => prettyJson({ [name]: value }), [name, value])
  const preview = useMemo(() => {
    if (value === undefined) return t('config.previewNotSet')
    if (value === null) return 'null'
    if (Array.isArray(value)) return t('config.previewItems', { count: value.length })
    if (isRecord(value)) return t('config.previewFields', { count: Object.keys(value).length })
    return String(value)
  }, [value, t])

  return (
    <div className="rounded-lg border border-border-200/50">
      <div className="flex items-center gap-2 pl-3 pr-1.5">
        <button
          type="button"
          onClick={() => setExpanded(current => !current)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
        >
          {expanded ? (
            <ChevronDownIcon size={14} className="shrink-0 text-text-400" />
          ) : (
            <ChevronRightIcon size={14} className="shrink-0 text-text-400" />
          )}
          <span className="truncate font-mono text-[length:var(--fs-sm)] font-medium text-text-100">{name}</span>
          <span className="truncate text-[length:var(--fs-xs)] text-text-400">{preview}</span>
        </button>
        <CopyJsonButton text={json} label={t('config.copyJson')} copiedLabel={t('config.copied')} />
      </div>
      {expanded && (
        <pre className="max-h-64 overflow-auto border-t border-border-200/40 px-3 py-2 font-mono text-[length:var(--fs-xs)] leading-relaxed text-text-300 custom-scrollbar">
          {json}
        </pre>
      )}
    </div>
  )
}

/**
 * 读全局配置里的 shell（字符串形式；未设置 → `''`）
 *
 * 拆成小函数是为了配合 `readGlobalShellSettled()` 的重试。
 */
async function readGlobalShell(): Promise<string> {
  const global = await getGlobalConfig()
  const record = asRecord(global)
  return typeof record.shell === 'string' ? record.shell : ''
}

/**
 * 读全局配置里的 shell，**最多重试到期望值**（阶段 3b 实测新增）
 *
 * 🔴 为什么需要重试：`PATCH /api/experimental/config` 写完后，服务端要等配置文件被
 *    watcher 重新读入才会在 `GET /api/config` 的 `info` 里体现 —— **实测写完立刻读是旧值**，
 *    约 1 秒后才变成新值（`POST /api/location/reload` 也不能立刻修好）。
 *    → 保存后如果只读一次，界面会把下拉框「回滚」到旧值，用户以为没保存成功。
 *
 * 返回最后一次读到的值（重试用尽仍不一致就返回它，由调用方决定怎么展示）。
 */
async function readGlobalShellSettled(expected: string, timeoutMs = 2500): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let current = await readGlobalShell()
  while (current !== expected && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 150))
    current = await readGlobalShell()
  }
  return current
}

/**
 * 配置查看弹窗
 *
 * 数据来源：
 *   - 只读展示：getConfig(directory) —— GET /api/config 合并后的**生效配置**（有损视图）
 *   - shell 当前值：getGlobalConfig() —— 与写入口（PATCH /api/experimental/config）保持一致
 */
function ConfigViewerDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const directory = useCurrentDirectory()
  const [effective, setEffective] = useState<JsonRecord>({})
  const [shells, setShells] = useState<ShellOption[]>([])
  const [shellValue, setShellValue] = useState('')
  const [savedShell, setSavedShell] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadRequestRef = useRef(0)
  const saveRequestRef = useRef(0)

  const shellDirty = shellValue !== savedShell
  const entries = useMemo(() => Object.entries(effective).sort(([a], [b]) => a.localeCompare(b)), [effective])
  const allJson = useMemo(() => prettyJson(effective), [effective])
  // 当前值不在服务端返回的 shell 列表里（例如自定义路径）时补一个选项，避免下拉框显示空白
  const shellOptions = useMemo(() => {
    const options = [...shells]
    if (shellValue && !options.some(option => option.value === shellValue)) {
      options.unshift({ value: shellValue, label: shellValue })
    }
    return options
  }, [shells, shellValue])

  const load = useCallback(async () => {
    if (!isOpen) return
    const request = ++loadRequestRef.current
    setLoading(true)
    setError(null)
    setSaved(false)
    try {
      const [currentShell, effectiveConfig, shellList] = await Promise.all([
        readGlobalShell(),
        getConfig(directory),
        listAvailableShells(directory).catch(() => []),
      ])
      if (request !== loadRequestRef.current) return
      setShellValue(currentShell)
      setSavedShell(currentShell)
      setEffective(asRecord(effectiveConfig))
      setShells(
        shellList.map(shell => ({
          value: shell.name === shell.path ? shell.path : shell.name,
          label: shell.name,
          hint: shell.path,
          disabled: !shell.acceptable,
        })),
      )
    } catch (err) {
      if (request !== loadRequestRef.current) return
      setError(err instanceof Error ? err.message : t('config.loadFailed'))
    } finally {
      if (request === loadRequestRef.current) setLoading(false)
    }
  }, [directory, isOpen, t])

  useEffect(() => {
    if (isOpen) void load()
    else {
      // 弹窗关闭时让所有在途请求失效，避免过期结果覆盖界面
      loadRequestRef.current += 1
      saveRequestRef.current += 1
    }
  }, [isOpen, load])

  const saveShell = async () => {
    if (saving) return
    const request = ++saveRequestRef.current
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      // ✅ 唯一有效的写路径：PATCH /api/experimental/config，payload 只接受 { shell }
      // 空字符串表示「自动 / 清除」，交给 API 层转成 null。
      const requested = shellValue || ''
      await updateGlobalConfig({ shell: shellValue || undefined } as Config)
      if (request !== saveRequestRef.current) return
      // 回读，确认服务端真实落地的值（避免「以为保存了其实没有」）。
      // ⚠️ 必须**重试**：服务端配置 watcher 有约 1 秒滞后，只读一次会拿到旧值并把
      //    下拉框回滚（见 readGlobalShellSettled 的说明）。
      const [currentShell, effectiveConfig] = await Promise.all([
        readGlobalShellSettled(requested),
        getConfig(directory),
      ])
      if (request !== saveRequestRef.current) return
      setShellValue(currentShell)
      setSavedShell(currentShell)
      setEffective(asRecord(effectiveConfig))
      setSaved(true)
    } catch (err) {
      if (request !== saveRequestRef.current) return
      setError(err instanceof Error ? err.message : t('config.saveFailed'))
    } finally {
      if (request === saveRequestRef.current) setSaving(false)
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      rawContent
      width="min(97vw, 880px)"
      showCloseButton={false}
      ariaLabel={t('config.editorTitle')}
    >
      <div className="flex h-[min(90vh,820px)] flex-col">
        {/* 头部：标题 + 关闭 */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-100/50 px-5 py-3.5">
          <h2 className="min-w-0 truncate text-[length:var(--fs-heading-2)] font-semibold text-text-100">
            {t('config.editorTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('closeSettings')}
            title={t('closeSettings')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-400/70 transition-colors hover:bg-bg-200/70 hover:text-text-200"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 custom-scrollbar">
          {error && (
            <div className="break-words rounded-lg bg-error-100/10 px-3 py-2 text-[length:var(--fs-xs)] text-error-100">
              {error}
            </div>
          )}
          {loading && (
            <div className="rounded-lg bg-bg-100/50 px-3 py-2 text-[length:var(--fs-xs)] text-text-400">
              {t('config.loading')}
            </div>
          )}

          {/* 说明 1：为什么其它字段改不了 */}
          <div className="flex items-start gap-2.5 rounded-lg border border-warning-100/20 bg-warning-bg/40 px-3.5 py-3 text-[length:var(--fs-xs)] leading-relaxed text-text-300">
            <AlertCircleIcon size={14} className="mt-0.5 shrink-0 text-warning-100" />
            <span>{t('config.readOnlyNotice')}</span>
          </div>

          {/* 说明 2：数据来源是有损视图 */}
          <div className="rounded-lg bg-bg-100/50 px-3.5 py-3 text-[length:var(--fs-xs)] leading-relaxed text-text-400">
            {t('config.lossyNotice')}
          </div>

          {/* shell：唯一可图形化编辑并保存的配置项 */}
          <section className="rounded-lg border border-accent-main-100/25 px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[length:var(--fs-sm)] font-medium text-text-100">shell</span>
                  <span className="rounded bg-accent-main-100/15 px-1.5 py-0.5 text-[length:var(--fs-xxs)] text-accent-main-100">
                    {t('config.shellEditableBadge')}
                  </span>
                </div>
                <div className="mt-0.5 text-[length:var(--fs-xs)] leading-relaxed text-text-300">
                  {t('config.shellDesc')}
                </div>
              </div>
              <button
                type="button"
                onClick={saveShell}
                disabled={!shellDirty || saving || loading}
                className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md bg-accent-main-100 px-2.5 text-[length:var(--fs-xs)] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <CheckIcon size={13} />
                {saving ? t('config.saving') : t('config.saveShell')}
              </button>
            </div>
            <select
              value={shellValue}
              onChange={event => {
                setShellValue(event.target.value)
                setSaved(false)
              }}
              aria-label="shell"
              className={`${settingsFieldClass} mt-2.5`}
            >
              <option value="">{t('config.shellAuto')}</option>
              {shellOptions.map(shell => (
                <option key={shell.value} value={shell.value} disabled={shell.disabled}>
                  {shell.hint ? `${shell.label} (${shell.hint})` : shell.label}
                </option>
              ))}
            </select>
            {saved && (
              <div className="mt-1.5 text-[length:var(--fs-xs)] text-success-100">{t('config.shellSaved')}</div>
            )}
          </section>

          {/* 只读配置区块：每个区块可单独复制 JSON */}
          <section>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[length:var(--fs-sm)] font-medium text-text-100">
                  {t('config.effectiveTitle')}
                </span>
                <span className="rounded bg-bg-200/70 px-1.5 py-0.5 text-[length:var(--fs-xxs)] text-text-400">
                  {t('config.readOnlyBadge')}
                </span>
              </div>
              <CopyJsonButton text={allJson} label={t('config.copyAllJson')} copiedLabel={t('config.copied')} />
            </div>
            <p className="mt-1 text-[length:var(--fs-xs)] leading-relaxed text-text-400">{t('config.copyHint')}</p>
            <div className="mt-2.5 space-y-1.5">
              {entries.length === 0 && !loading ? (
                <div className="rounded-lg bg-bg-100/50 px-3 py-2 text-[length:var(--fs-xs)] text-text-400">
                  {t('config.emptyConfig')}
                </div>
              ) : (
                entries.map(([name, value]) => <ConfigJsonBlock key={name} name={name} value={value} />)
              )}
            </div>
          </section>
        </div>
      </div>
    </Dialog>
  )
}

export function ConfigSettings() {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  return (
    <div>
      <SettingsSection
        title={t('config.sourceTitle')}
        description={t('config.sourceDesc')}
        actions={
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[length:var(--fs-sm)] font-medium text-accent-main-100 transition-colors hover:bg-accent-main-100/10"
          >
            <SettingsIcon size={14} />
            {t('config.openEditor')}
          </button>
        }
      >
        <div className="flex items-start gap-2.5 rounded-lg border border-warning-100/20 bg-warning-bg/40 px-3.5 py-3 text-[length:var(--fs-sm)] leading-relaxed text-text-300">
          <AlertCircleIcon size={14} className="mt-0.5 shrink-0 text-warning-100" />
          <span>{t('config.readOnlySummary')}</span>
        </div>
      </SettingsSection>
      <ConfigViewerDialog isOpen={open} onClose={() => setOpen(false)} />
    </div>
  )
}
