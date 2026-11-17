import { useCallback, useState } from 'react'

type DisclosureState = {
  value: boolean
  touched: boolean
}

const disclosureStateCache = new Map<string, DisclosureState>()
/** 长会话里每张工具卡/折叠块都会留下一个 key，给个上限避免无限长 */
const DISCLOSURE_CACHE_LIMIT = 4000
const UI_STATE_CACHE_LIMIT = 500

function rememberCached<V>(map: Map<string, V>, key: string, value: V, limit: number) {
  map.delete(key)
  map.set(key, value)
  while (map.size > limit) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

function rememberDisclosure(key: string, value: DisclosureState) {
  disclosureStateCache.delete(key)
  disclosureStateCache.set(key, value)
  if (disclosureStateCache.size <= DISCLOSURE_CACHE_LIMIT) return

  // 先淘汰用户没碰过的条目：手动折叠/展开过的选择比「初始展开态」更值得保留
  for (const [candidate, state] of disclosureStateCache) {
    if (disclosureStateCache.size <= DISCLOSURE_CACHE_LIMIT) return
    if (!state.touched) disclosureStateCache.delete(candidate)
  }
  while (disclosureStateCache.size > DISCLOSURE_CACHE_LIMIT) {
    const oldest = disclosureStateCache.keys().next().value
    if (oldest === undefined) break
    disclosureStateCache.delete(oldest)
  }
}

export function getUiDisclosureState(key: string, fallback: boolean): DisclosureState {
  const cached = disclosureStateCache.get(key)
  if (cached) return cached
  const initial = { value: fallback, touched: false }
  rememberDisclosure(key, initial)
  return initial
}

export function setUiDisclosureState(key: string, value: boolean, touched = true) {
  rememberDisclosure(key, { value, touched })
}

export function hasUserTouchedUiDisclosure(key: string): boolean {
  return disclosureStateCache.get(key)?.touched ?? false
}

const uiStateCache = new Map<string, unknown>()

export function getUiState<T>(key: string, fallback: T): T {
  if (!uiStateCache.has(key)) {
    rememberCached(uiStateCache, key, fallback, UI_STATE_CACHE_LIMIT)
    return fallback
  }
  return (uiStateCache.get(key) as T) ?? fallback
}

export function setUiState<T>(key: string, value: T) {
  rememberCached(uiStateCache, key, value, UI_STATE_CACHE_LIMIT)
}

export function useUiState<T>(key: string | undefined, fallback: T) {
  const [cached, setCached] = useState(() => ({ key, state: key ? getUiState(key, fallback) : fallback }))
  const state = cached.key === key ? cached.state : key ? getUiState(key, fallback) : fallback

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setCached(prev => {
        const previousState = prev.key === key ? prev.state : key ? getUiState(key, fallback) : fallback
        const resolved = typeof next === 'function' ? (next as (prev: T) => T)(previousState) : next
        if (key) setUiState(key, resolved)
        return { key, state: resolved }
      })
    },
    [fallback, key],
  )

  return [state, setValue] as const
}

export function useUiDisclosureState(key: string, fallback: boolean) {
  const [cached, setCached] = useState(() => ({ key, state: getUiDisclosureState(key, fallback) }))
  const state = cached.key === key ? cached.state : getUiDisclosureState(key, fallback)

  const setValue = useCallback(
    (next: boolean | ((prev: boolean) => boolean), options?: { touched?: boolean; respectUser?: boolean }) => {
      setCached(prev => {
        const previousState = prev.key === key ? prev.state : getUiDisclosureState(key, fallback)
        if (options?.respectUser && previousState.touched)
          return prev.key === key ? prev : { key, state: previousState }
        const resolved = typeof next === 'function' ? (next as (prev: boolean) => boolean)(previousState.value) : next
        const touched = options?.touched ?? true
        const nextState = { value: resolved, touched: previousState.touched || touched }
        rememberDisclosure(key, nextState)
        return { key, state: nextState }
      })
    },
    [fallback, key],
  )

  return [state.value, setValue, state.touched] as const
}
