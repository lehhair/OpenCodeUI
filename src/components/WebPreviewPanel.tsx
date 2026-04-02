import { memo, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { RedoIcon, RetryIcon, UndoIcon } from './Icons'
import { layoutStore, useLayoutStore } from '../store/layoutStore'

interface WebPreviewPanelProps {
  tabId: string
}

interface NavigationState {
  history: string[]
  index: number
}

function isLikelyLocalAddress(input: string): boolean {
  return [
    /^localhost(?::\d+)?(?:\/|$)/i,
    /^(?:127(?:\.\d{1,3}){3}|0\.0\.0\.0)(?::\d+)?(?:\/|$)/,
    /^\[(?:::1|[0-9a-f:]+)\](?::\d+)?(?:\/|$)/i,
    /^10(?:\.\d{1,3}){3}(?::\d+)?(?:\/|$)/,
    /^192\.168(?:\.\d{1,3}){2}(?::\d+)?(?:\/|$)/,
    /^172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}(?::\d+)?(?:\/|$)/,
  ].some(pattern => pattern.test(input))
}

function normalizeWebPreviewUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
  const withProtocol = hasProtocol ? trimmed : `${isLikelyLocalAddress(trimmed) ? 'http' : 'https'}://${trimmed}`

  try {
    const parsed = new URL(withProtocol)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

export const WebPreviewPanel = memo(function WebPreviewPanel({ tabId }: WebPreviewPanelProps) {
  const { t } = useTranslation('components')
  const { panelTabs } = useLayoutStore()
  const tab = useMemo(
    () => panelTabs.find(item => item.id === tabId && item.type === 'web-preview') ?? null,
    [panelTabs, tabId],
  )
  const [inputValue, setInputValue] = useState(tab?.url ?? '')
  const [errorKey, setErrorKey] = useState<'invalidUrl' | null>(null)
  const [navigationState, setNavigationState] = useState<NavigationState>(() => ({
    history: tab?.url ? [tab.url] : [],
    index: tab?.url ? 0 : -1,
  }))
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setInputValue(tab?.url ?? '')
  }, [tab?.url])

  useEffect(() => {
    if (!tab?.url) {
      return
    }

    setNavigationState(prev => {
      if (prev.history.length > 0) {
        return prev
      }

      return {
        history: [tab.url!],
        index: 0,
      }
    })
  }, [tab?.url])

  const committedUrl = tab?.url?.trim() ?? ''
  const canGoBack = navigationState.index > 0
  const canGoForward = navigationState.index >= 0 && navigationState.index < navigationState.history.length - 1

  const commitUrl = (nextUrl: string) => {
    setErrorKey(null)
    setInputValue(nextUrl)
    layoutStore.updateWebPreviewUrl(tabId, nextUrl)
    setNavigationState(prev => {
      const baseHistory = prev.index >= 0 ? prev.history.slice(0, prev.index + 1) : prev.history.slice(0, 0)
      if (baseHistory[baseHistory.length - 1] === nextUrl) {
        return {
          history: baseHistory,
          index: baseHistory.length - 1,
        }
      }

      const nextHistory = [...baseHistory, nextUrl]
      return {
        history: nextHistory,
        index: nextHistory.length - 1,
      }
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedUrl = normalizeWebPreviewUrl(inputValue)
    if (!normalizedUrl) {
      setErrorKey('invalidUrl')
      return
    }

    commitUrl(normalizedUrl)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-100">
      <form
        aria-label={t('webPreview.addressBar')}
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-b border-border-200/60 px-3 py-2"
      >
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={t('webPreview.back')}
            title={t('webPreview.back')}
            disabled={!canGoBack}
            onClick={() => {
              if (!canGoBack) {
                return
              }

              const previousUrl = navigationState.history[navigationState.index - 1]
              if (!previousUrl) {
                return
              }

              setNavigationState(prev => ({
                history: prev.history,
                index: prev.index - 1,
              }))
              setErrorKey(null)
              setInputValue(previousUrl)
              layoutStore.updateWebPreviewUrl(tabId, previousUrl)
            }}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border-200/60 bg-bg-000 text-text-200 transition-colors hover:bg-bg-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <UndoIcon size={14} />
          </button>
          <button
            type="button"
            aria-label={t('webPreview.forward')}
            title={t('webPreview.forward')}
            disabled={!canGoForward}
            onClick={() => {
              if (!canGoForward) {
                return
              }

              const nextUrl = navigationState.history[navigationState.index + 1]
              if (!nextUrl) {
                return
              }

              setNavigationState(prev => ({
                history: prev.history,
                index: prev.index + 1,
              }))
              setErrorKey(null)
              setInputValue(nextUrl)
              layoutStore.updateWebPreviewUrl(tabId, nextUrl)
            }}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border-200/60 bg-bg-000 text-text-200 transition-colors hover:bg-bg-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RedoIcon size={14} />
          </button>
          <button
            type="button"
            aria-label={t('webPreview.refresh')}
            title={t('webPreview.refresh')}
            disabled={!committedUrl}
            onClick={() => {
              if (!committedUrl) {
                return
              }
              setRefreshKey(current => current + 1)
            }}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border-200/60 bg-bg-000 text-text-200 transition-colors hover:bg-bg-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RetryIcon size={14} />
          </button>
        </div>
        <input
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={inputValue}
          onChange={event => {
            setInputValue(event.target.value)
            if (errorKey) {
              setErrorKey(null)
            }
          }}
          placeholder={t('webPreview.placeholder')}
          className="h-9 w-full rounded-md border border-border-200/60 bg-bg-000 px-3 text-sm text-text-100 outline-none transition-colors placeholder:text-text-500 focus:border-border-300"
        />
        <button
          type="submit"
          className="h-9 shrink-0 rounded-md bg-bg-200 px-3 text-xs text-text-100 transition-colors hover:bg-bg-300"
        >
          {t('webPreview.open')}
        </button>
      </form>

      {errorKey ? <div className="px-3 py-2 text-xs text-danger-100">{t(`webPreview.${errorKey}`)}</div> : null}

      <div className="min-h-0 flex-1 bg-bg-000">
        {committedUrl ? (
          <iframe
            key={`${committedUrl}:${refreshKey}`}
            title={t('webPreview.title')}
            src={committedUrl}
            sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts"
            referrerPolicy="no-referrer"
            className="h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-400">
            {t('webPreview.empty')}
          </div>
        )}
      </div>
    </div>
  )
})

export default WebPreviewPanel
