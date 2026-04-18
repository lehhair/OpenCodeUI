import { useSyncExternalStore, useCallback } from 'react'
import { getActiveModels, type ModelInfo } from '../api'

// ============================================
// Global singleton so every ChatPane shares one models array.
// Prevents duplicate API requests and the race condition where a
// late-mounting pane sees an empty models list, falls back to
// models[0], and overwrites the persisted model selection.
// ============================================

interface ModelsState {
  models: ModelInfo[]
  isLoading: boolean
  error: Error | null
}

type Listener = () => void

let _state: ModelsState = { models: [], isLoading: true, error: null }
let _fetchPromise: Promise<void> | null = null
const _listeners = new Set<Listener>()

function _notify() {
  for (const fn of _listeners) fn()
}

function _setState(patch: Partial<ModelsState>) {
  _state = { ..._state, ...patch }
  _notify()
}

async function _fetchModels() {
  if (_fetchPromise) return _fetchPromise

  _fetchPromise = (async () => {
    _setState({ isLoading: true, error: null })
    try {
      const data = await getActiveModels()
      _setState({ models: data, isLoading: false })
    } catch (e) {
      _setState({ error: e instanceof Error ? e : new Error('Failed to fetch models'), isLoading: false })
    } finally {
      _fetchPromise = null
    }
  })()

  return _fetchPromise
}

// First fetch on module load — models are ready before any component mounts.
_fetchModels()

function _subscribe(listener: Listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

function _getSnapshot(): ModelsState {
  return _state
}

// ============================================
// Hook — drop-in replacement, same return type
// ============================================

interface UseModelsResult {
  models: ModelInfo[]
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useModels(): UseModelsResult {
  const state = useSyncExternalStore(_subscribe, _getSnapshot)
  const refetch = useCallback(() => _fetchModels(), [])

  return {
    models: state.models,
    isLoading: state.isLoading,
    error: state.error,
    refetch,
  }
}
