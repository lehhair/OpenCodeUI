import { useCallback, useState } from 'react'

type DisclosureState = {
  value: boolean
  touched: boolean
}

const disclosureStateCache = new Map<string, DisclosureState>()

export function getUiDisclosureState(key: string, fallback: boolean): DisclosureState {
  const cached = disclosureStateCache.get(key)
  if (cached) return cached
  const initial = { value: fallback, touched: false }
  disclosureStateCache.set(key, initial)
  return initial
}

export function setUiDisclosureState(key: string, value: boolean, touched = true) {
  disclosureStateCache.set(key, { value, touched })
}

export function hasUserTouchedUiDisclosure(key: string): boolean {
  return disclosureStateCache.get(key)?.touched ?? false
}

const uiStateCache = new Map<string, unknown>()

export function getUiState<T>(key: string, fallback: T): T {
  if (!uiStateCache.has(key)) {
    uiStateCache.set(key, fallback)
    return fallback
  }
  return (uiStateCache.get(key) as T) ?? fallback
}

export function setUiState<T>(key: string, value: T) {
  uiStateCache.set(key, value)
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
        disclosureStateCache.set(key, nextState)
        return { key, state: nextState }
      })
    },
    [fallback, key],
  )

  return [state.value, setValue, state.touched] as const
}
