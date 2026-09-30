// ============================================
// DialogAddWslServer —— 官方 packages/app/src/wsl/dialog-add-server.tsx 的 React 还原
// 视图状态机（loading/pendingRestart/checking/unavailable/ready）、main/catalog
// 双视图、primaryButton 状态机、探测计划状态机（probe plan + failure gate）
// 全部对齐官方实现
// ============================================

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { SpinnerIcon, DownloadIcon, ChevronRightIcon } from '../../../components/Icons'
import { wslApi } from '../../../api/wsl'
import { useWslStore } from '../../../store/wslStore'
import { notificationStore } from '../../../store/notificationStore'
import { addServerProbePlan, addServerViewModel, createProbeFailureGate, type AddServerText } from '../settings-model'

/** 判定 WSL 运行时错误是否属于"未安装"（官方 isWslRuntimeMissing），
 *  决定 unavailable 弹窗显示"安装 WSL"按钮还是纯错误信息 */
function isWslRuntimeMissing(error: string | null | undefined) {
  if (!error) return true
  return /WSL is not installed|not been installed|wsl(?:\.exe)? --install/i.test(error)
}

function translate(t: (key: string, params?: Record<string, string>) => string, value: AddServerText) {
  if (value.params) return t(value.key, value.params)
  return t(value.key)
}

/** 请求失败的用户可见反馈（官方 requestError 的 toast 等价实现） */
function requestError(err: unknown) {
  console.error('WSL servers request failed', err instanceof Error ? (err.stack ?? err.message) : String(err))
  const message = err instanceof Error ? err.message : String(err)
  notificationStore.push('error', message, message, '')
}

/** 判定是否为 UAC 提权被用户拒绝（PowerShell Start-Process -Verb RunAs 的取消形态，
 *  中文 Windows 报「操作已被用户取消」、英文报 "canceled by the user"） */
function isUacDeniedError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  return /canceled by the user|cancelled by the user|操作已被用户取消/i.test(message)
}

interface DialogWslServerProps {
  isOpen: boolean
  onClose: () => void
  onAdded?: () => void | Promise<void>
}

export function DialogAddWslServer({ isOpen, onClose, onAdded }: DialogWslServerProps) {
  const { t } = useTranslation('settings')
  const wsl = useWslStore()
  const [view, setView] = useState<'main' | 'catalog'>('main')
  const [selectedDistro, setSelectedDistro] = useState<string | null>(null)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogTarget, setCatalogTarget] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [probingAddable, setProbingAddable] = useState(false)
  // 状态变化后强制重算探测计划（effect 依赖兜底）
  const [, setTick] = useState(0)
  const gateRef = useRef(createProbeFailureGate())
  const probingRef = useRef(false)

  const model = addServerViewModel({
    state: wsl ?? undefined,
    view,
    selectedDistro,
    catalogSearch,
    catalogTarget,
    adding,
    probingAddable,
  })

  // 探测计划状态机（官方 add-server-probes.ts 的 React 版）：
  // 状态变化重算计划 → gate 放行 → 执行 → settle；同 key 失败不自动重试，
  // 用户显式操作（checkAgain 等）时 reset
  useEffect(() => {
    if (!isOpen || probingRef.current) return
    const gate = gateRef.current
    const plan = addServerProbePlan({
      state: wsl ?? undefined,
      view,
      adding,
      busy: model.busy,
      selectedDistro: model.selectedDistro,
      addableInstalledDistros: model.addableInstalledDistros,
    })
    if (!plan || !gate.accepts(plan.key)) return

    const run = (action: () => Promise<void>) => {
      probingRef.current = true
      action()
        .then(
          () => gate.settle(plan.key),
          (error: unknown) => {
            gate.settle(plan.key, error)
            console.error('WSL probe failed:', error)
          },
        )
        .finally(() => {
          probingRef.current = false
          setTick(tick => tick + 1)
        })
    }

    if (plan.kind === 'auto') {
      run(() => (plan.plan.action === 'probeRuntime' ? wslApi.probeRuntime() : wslApi.refreshDistros()))
      return
    }
    setProbingAddable(true)
    run(() =>
      wslApi.probeAddable(plan.plan.distros).finally(() => {
        setProbingAddable(false)
      }),
    )
  }, [isOpen, wsl, view, adding, model.busy, model.selectedDistro, model.addableInstalledDistros])

  const run = (action: () => Promise<unknown>) => {
    void action().catch((err: unknown) => requestError(err))
  }

  const refreshDistros = () => {
    gateRef.current.reset()
    // 用户显式「重新检测」：绕过在线目录缓存强制联网刷新
    run(() => wslApi.refreshDistros(true))
  }

  /** runtime 探测重试（unavailable 分支的「重新检测」）：与自动探测共用同一触发器，
   *  reset 失败门控后手动执行；结果经 wslStore 状态回流驱动视图切换 */
  const recheckRuntime = () => {
    gateRef.current.reset()
    run(() => wslApi.probeRuntime())
  }

  /** 安装 WSL 运行时（触发 UAC 提权）：用户拒绝提权时给可读的本地化文案，
   *  其余错误原样透出 */
  const installWsl = () => {
    run(async () => {
      try {
        await wslApi.installWsl()
      } catch (err) {
        throw isUacDeniedError(err) ? new Error(t('wsl.onboarding.uacDenied')) : err
      }
    })
  }

  const installDistro = (name: string) => {
    gateRef.current.reset()
    run(async () => {
      await wslApi.installDistro(name)
      setView('main')
    })
  }

  const installCatalogDistro = () => {
    if (model.installingCatalogDistro) return
    const name = model.catalogTarget
    if (!name) return
    installDistro(name)
  }

  const closeCatalog = () => {
    gateRef.current.reset()
    setView('main')
    setCatalogSearch('')
    setCatalogTarget(null)
  }

  const runPrimary = async () => {
    const button = model.primaryButton
    if (button.loading) return
    const distro = model.selectedDistro
    const action = button.action
    if (!distro || !action) return
    if (action === 'install-opencode') {
      run(() => wslApi.installOpencode(distro))
      return
    }
    setAdding(true)
    try {
      await wslApi.addServer(distro)
      await onAdded?.()
      onClose()
    } catch (err) {
      requestError(err)
    } finally {
      setAdding(false)
    }
  }

  if (!isOpen) return null

  // 状态树尚未从后端到达（loading）
  if (!wsl) {
    return (
      <Dialog isOpen onClose={onClose} width={440}>
        <div className="py-8 flex justify-center">
          <SpinnerIcon size={20} className="animate-spin text-text-400" />
        </div>
      </Dialog>
    )
  }

  const runtimeError = wsl.runtime?.error ?? null

  // WSL 不可用 / 待重启 / 运行时检查中（官方 runtimeState 分支）
  if (model.runtimeState !== 'ready') {
    if (model.runtimeState === 'checking' || model.runtimeState === 'loading') {
      return (
        <Dialog isOpen onClose={onClose} width={440}>
          <div className="py-8 flex justify-center">
            <SpinnerIcon size={20} className="animate-spin text-text-400" />
          </div>
        </Dialog>
      )
    }
    return (
      <DialogWslSetup
        state={model.runtimeState}
        error={runtimeError}
        installable={isWslRuntimeMissing(runtimeError)}
        busy={model.busy}
        onInstall={installWsl}
        onRecheck={recheckRuntime}
        onClose={onClose}
      />
    )
  }

  const primaryButton = model.primaryButton

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={view === 'main' ? t('wsl.server.add') : t('wsl.onboarding.installDistro')}
      width={440}
    >
      {view === 'catalog' ? (
        <>
          <div className="space-y-3">
            <input
              type="text"
              value={catalogSearch}
              disabled={model.busy}
              onChange={e => setCatalogSearch(e.target.value)}
              placeholder={t('wsl.onboarding.searchDistros')}
              className="w-full h-9 px-3 rounded-lg bg-bg-200/60 border border-border-200/60 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-500 focus:outline-none focus:border-accent-main-100/60"
            />
            <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar">
              {model.filteredInstallableDistros.length === 0 ? (
                model.distrosChecking ? (
                  // 在线目录同样受列表刷新影响：刷新期间显示检测中
                  <div
                    className="flex items-center justify-center gap-2 py-4 text-text-400 text-[length:var(--fs-xs)]"
                    role="status"
                    aria-live="polite"
                  >
                    <SpinnerIcon size={14} className="animate-spin" />
                    <span>{t('wsl.onboarding.checkingDistros')}</span>
                  </div>
                ) : (
                  <p className="text-text-400 text-[length:var(--fs-xs)] py-4 text-center">
                    {t('wsl.onboarding.noDistros')}
                  </p>
                )
              ) : (
                model.filteredInstallableDistros.map(d => (
                  <button
                    key={d.name}
                    type="button"
                    disabled={model.busy}
                    onClick={() => setCatalogTarget(d.name)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left transition-colors
                      ${
                        catalogTarget === d.name
                          ? 'border-accent-main-100/40 bg-accent-main-100/5'
                          : 'border-border-200/40 hover:border-border-300'
                      }`}
                  >
                    <span className="text-[length:var(--fs-sm)] font-medium text-text-100">{d.label}</span>
                    <span className="text-[length:var(--fs-xs)] text-text-400 font-mono">{d.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" size="sm" disabled={model.busy} onClick={closeCatalog}>
              {t('common:cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              style={{ minWidth: '99px' }}
              disabled={model.busy || !model.catalogTarget}
              isLoading={model.installingCatalogDistro}
              onClick={installCatalogDistro}
            >
              {t('wsl.onboarding.installDistro')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[length:var(--fs-sm)] font-medium text-text-200">
                {t('wsl.onboarding.installedDistros')}
              </span>
              <Button variant="ghost" size="sm" disabled={model.busy} onClick={refreshDistros}>
                {t('wsl.onboarding.checkAgain')}
              </Button>
            </div>

            <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar">
              {model.addableInstalledDistros.length === 0 ? (
                model.distrosChecking ? (
                  // 列表还在后台刷新：显示检测中而不是"尚未检测到"（WSL 冷启动可能要等较久）
                  <div
                    className="flex items-center justify-center gap-2 py-4 text-text-400 text-[length:var(--fs-xs)]"
                    role="status"
                    aria-live="polite"
                  >
                    <SpinnerIcon size={14} className="animate-spin" />
                    <span>{t('wsl.onboarding.checkingDistros')}</span>
                  </div>
                ) : (
                  <p className="text-text-400 text-[length:var(--fs-xs)] py-4 text-center">
                    {model.visibleInstalledDistros.length
                      ? t('wsl.onboarding.allDistrosAdded')
                      : t('wsl.onboarding.noDistros')}
                  </p>
                )
              ) : (
                model.addableInstalledDistros.map(d => {
                  const status = model.distroStatuses[d.name]
                  // 能力探测失败（canExecute=false）：提示用户打开一次发行版，行内直接给「打开终端」入口
                  const needsOpenOnce = wsl.distroProbes[d.name]?.canExecute === false
                  // 行容器用 div 而非 button：HTML 不允许按钮嵌套，禁用语义用 aria-disabled + 跳过触发表达
                  const rowDisabled = d.version === 1 || model.busy
                  // WSL 1 发行版不可添加：保留可聚焦并经 aria-describedby 指向行内「WSL 2 required」原因，
                  // 键盘用户也能读到不能选的原因（临时 busy 行无需解释，维持不可聚焦）
                  const wsl2Required = d.version === 1
                  const wsl2ReasonId = `wsl2-required-${d.name}`
                  const selectDistro = () => setSelectedDistro(d.name)
                  return (
                    <div
                      key={d.name}
                      role="button"
                      tabIndex={rowDisabled && !wsl2Required ? undefined : 0}
                      aria-disabled={rowDisabled || undefined}
                      aria-describedby={wsl2Required ? wsl2ReasonId : undefined}
                      onClick={() => {
                        if (!rowDisabled) selectDistro()
                      }}
                      onKeyDown={e => {
                        // 只响应行自身的按键；焦点在行内「打开终端」按钮上时 Enter/Space 不触发选中
                        if (rowDisabled || e.target !== e.currentTarget) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          selectDistro()
                        }
                      }}
                      className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left transition-colors
                        ${
                          selectedDistro === d.name
                            ? 'border-accent-main-100/40 bg-accent-main-100/5'
                            : rowDisabled
                              ? 'border-border-200/20 opacity-50 cursor-not-allowed'
                              : 'border-border-200/40 hover:border-border-300'
                        }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[length:var(--fs-sm)] font-medium text-text-100">{d.name}</div>
                        <div className="text-[length:var(--fs-xs)] text-text-400 mt-0.5">
                          WSL {d.version ?? '?'}
                          {wsl.opencodeChecks[d.name]?.version && ` · OpenCode v${wsl.opencodeChecks[d.name]!.version}`}
                        </div>
                      </div>
                      {(status || needsOpenOnce) && (
                        <div className="shrink-0 flex items-center gap-1.5 ml-2">
                          {status && (
                            <span
                              id={wsl2Required ? wsl2ReasonId : undefined}
                              className={`text-[length:var(--fs-xs)] ${
                                status.tone === 'success'
                                  ? 'text-success-100'
                                  : status.tone === 'warning'
                                    ? 'text-warning-100'
                                    : 'text-text-400'
                              }`}
                            >
                              {translate(t, status.label)}
                            </span>
                          )}
                          {needsOpenOnce && (
                            <button
                              type="button"
                              onClick={e => {
                                // 不冒泡到行容器，避免「打开终端」同时触发发行版选中
                                e.stopPropagation()
                                wslApi.openTerminal(d.name).catch((err: unknown) => requestError(err))
                              }}
                              className="shrink-0 whitespace-nowrap rounded-md h-7 px-2 text-[length:var(--fs-xs)] font-medium text-text-400 hover:text-accent-main-100 hover:bg-accent-main-100/10 transition-colors"
                            >
                              {t('wsl.onboarding.openTerminal')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {/* 需要其他发行版 → 在线目录入口（官方 needAnotherDistro 卡片） */}
            {model.installableDistros.length > 0 && (
              <button
                type="button"
                disabled={model.busy}
                onClick={() => {
                  setView('catalog')
                  setCatalogSearch('')
                  setCatalogTarget(model.installableDistros[0]?.name ?? null)
                }}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border-200/40 hover:border-border-300 text-left transition-colors"
              >
                <DownloadIcon size={16} className="shrink-0 text-text-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[length:var(--fs-sm)] font-medium text-text-100">
                    {t('wsl.onboarding.needAnotherDistro')}
                  </span>
                  <span className="block text-[length:var(--fs-xs)] text-text-400 mt-0.5">
                    {t('wsl.onboarding.needAnotherDistroHint')}
                  </span>
                </span>
                <ChevronRightIcon size={16} className="shrink-0 text-text-400" />
              </button>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" size="sm" disabled={adding} onClick={onClose}>
              {t('common:cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!primaryButton.loading && primaryButton.disabled}
              isLoading={primaryButton.loading}
              style={primaryButton.minWidth ? { minWidth: primaryButton.minWidth } : undefined}
              onClick={() => void runPrimary()}
            >
              {!primaryButton.loading && translate(t, primaryButton.label)}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

/** WSL 不可用/待重启引导弹窗（官方 DialogWslSetup） */
function DialogWslSetup(props: {
  state: 'pendingRestart' | 'unavailable'
  error: string | null
  installable: boolean
  busy: boolean
  onInstall: () => void
  /** 「重新检测」：runtime 探测重试（与主视图 checkAgain 同一显式重试模式） */
  onRecheck: () => void
  onClose: () => void
}) {
  const { t } = useTranslation('settings')
  const title =
    props.state === 'pendingRestart'
      ? t('wsl.onboarding.restartRequired')
      : props.installable
        ? t('wsl.onboarding.wslNotInstalled.title')
        : t('wsl.onboarding.wslUnavailable.title')
  const description =
    props.state === 'pendingRestart'
      ? t('wsl.onboarding.windowsRestartRequired')
      : props.installable
        ? t('wsl.onboarding.wslNotInstalled.description')
        : t('wsl.onboarding.wslUnavailable.description')

  return (
    <Dialog isOpen onClose={props.onClose} width={440}>
      <div className="flex flex-col items-center text-center gap-2 py-4">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="text-text-400"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 -0.00244141L23.6926 20.2498H0.308594L12 -0.00244141ZM12.7954 6.32932C12.5844 6.11834 12.2982 5.99982 11.9999 5.99982C11.7015 5.99982 11.4154 6.11834 11.2044 6.32932C10.9934 6.5403 10.8749 6.82645 10.8749 7.12482V11.6248C10.8749 11.9232 10.9934 12.2093 11.2044 12.4203C11.4154 12.6313 11.7015 12.7498 11.9999 12.7498C12.2982 12.7498 12.5844 12.4203 12.7954 12.4203C13.0064 12.2093 13.1249 11.9232 13.1249 11.6248V7.12482C13.1249 6.82645 13.0064 6.5403 12.7954 6.32932ZM13.0605 17.5605C12.7792 17.8418 12.3977 17.9998 11.9999 17.9998C11.6021 17.9998 11.2205 17.8418 10.9392 17.5605C10.6579 17.2792 10.4999 16.8976 10.4999 16.4998C10.4999 16.102 10.6579 15.7205 10.9392 15.4392C11.2205 15.1579 11.6021 14.9998 11.9999 14.9998C12.3977 14.9998 12.7792 15.1579 13.0605 15.4392C13.3418 15.7205 13.4999 16.102 13.4999 16.4998C13.4999 16.8976 13.3418 17.2792 13.0605 17.5605Z"
            fill="currentColor"
          />
        </svg>
        <h2 className="text-[length:var(--fs-md)] font-medium text-text-100">{title}</h2>
        <p className="text-[length:var(--fs-sm)] text-text-400 whitespace-pre-line">{description}</p>
        {!props.installable && props.error && (
          <p className="text-[length:var(--fs-xs)] text-danger-100 break-all">{props.error}</p>
        )}
        {props.state === 'unavailable' && props.installable && (
          <>
            {/* UAC 预告：安装会弹系统提权确认，提前一句话说明，避免用户被突兀的 UAC 弹窗打断 */}
            <p className="text-[length:var(--fs-xs)] text-text-400">{t('wsl.onboarding.installWslAdminNotice')}</p>
            <Button variant="secondary" size="sm" disabled={props.busy} onClick={props.onInstall}>
              {t('wsl.onboarding.installWsl')}
            </Button>
          </>
        )}
        {props.state === 'unavailable' && (
          <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onRecheck}>
            {t('wsl.onboarding.checkAgain')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={props.onClose}>
          {t('common:close')}
        </Button>
      </div>
    </Dialog>
  )
}
