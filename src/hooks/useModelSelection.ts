// ============================================
// useModelSelection - 模型选择逻辑
// ============================================

import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react'
import type { ModelInfo } from '../api'
import {
  getModelKey,
  findModelByKey,
  saveModelVariantPref,
  getModelVariantPref,
  getSessionModelSelection,
  saveSessionModelSelection,
} from '../utils/modelUtils'
import { serverStorage } from '../utils/perServerStorage'
import { STORAGE_KEY_SELECTED_MODEL } from '../constants'

interface UseModelSelectionOptions {
  models: ModelInfo[]
  sessionId?: string | null
}

interface UseModelSelectionReturn {
  selectedModelKey: string | null
  selectedVariant: string | undefined
  currentModel: ModelInfo | undefined
  handleModelChange: (modelKey: string, model: ModelInfo) => void
  handleVariantChange: (variant: string | undefined) => void
  restoreFromMessage: (
    model: { providerID: string; modelID: string } | null | undefined,
    variant: string | null | undefined,
  ) => void
}

export function useModelSelection({ models, sessionId = null }: UseModelSelectionOptions): UseModelSelectionReturn {
  const sessionSelection = sessionId ? getSessionModelSelection(sessionId) : undefined
  const initialSessionSelection = sessionId ? getSessionModelSelection(sessionId) : undefined
  const initialSessionModel = initialSessionSelection
    ? findModelByKey(models, initialSessionSelection.modelKey)
    : undefined

  const [{ selectedModelKey, selectedVariant }, setSelection] = useState<{
    selectedModelKey: string | null
    selectedVariant: string | undefined
  }>(() => {
    if (initialSessionSelection && initialSessionModel) {
      return {
        selectedModelKey: initialSessionSelection.modelKey,
        selectedVariant: initialSessionSelection.variant ?? getModelVariantPref(initialSessionSelection.modelKey),
      }
    }

    const initialModelKey = serverStorage.get(STORAGE_KEY_SELECTED_MODEL)

    return {
      selectedModelKey: initialModelKey,
      selectedVariant: initialModelKey ? getModelVariantPref(initialModelKey) : undefined,
    }
  })
  const hydratedSessionRef = useRef<string | null>(initialSessionSelection && !initialSessionModel ? null : sessionId)
  const skipPersistenceRef = useRef<string | null>(null)

  const persistedModel = selectedModelKey ? findModelByKey(models, selectedModelKey) : undefined
  const currentModel = useMemo(() => persistedModel ?? models[0], [models, persistedModel])
  const resolvedModelKey = currentModel ? getModelKey(currentModel) : null
  const resolvedSelectedVariant = useMemo(() => {
    if (!resolvedModelKey) return undefined
    if (persistedModel && selectedModelKey === resolvedModelKey) return selectedVariant
    return getModelVariantPref(resolvedModelKey)
  }, [resolvedModelKey, persistedModel, selectedModelKey, selectedVariant])

  useEffect(() => {
    if (!sessionId) {
      hydratedSessionRef.current = null
      return
    }

    if (hydratedSessionRef.current === sessionId) return

    if (!sessionSelection) {
      hydratedSessionRef.current = sessionId
      return
    }

    const restoredModel = findModelByKey(models, sessionSelection.modelKey)
    if (!restoredModel) {
      if (models.length > 0) {
        hydratedSessionRef.current = sessionId
      }
      return
    }

    const nextVariant = sessionSelection.variant ?? getModelVariantPref(sessionSelection.modelKey)
    // Restoring the session-local model needs to happen before persistence runs,
    // otherwise the previous session's selection can be briefly written into the new session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelection({
      selectedModelKey: sessionSelection.modelKey,
      selectedVariant: nextVariant,
    })
    skipPersistenceRef.current = sessionId
    hydratedSessionRef.current = sessionId
  }, [models, sessionId, sessionSelection])

  useLayoutEffect(() => {
    if (sessionId && sessionSelection && hydratedSessionRef.current !== sessionId) return
    if (sessionId && skipPersistenceRef.current === sessionId) {
      skipPersistenceRef.current = null
      return
    }

    if (resolvedModelKey) {
      serverStorage.set(STORAGE_KEY_SELECTED_MODEL, resolvedModelKey)
      if (sessionId) {
        saveSessionModelSelection(sessionId, resolvedModelKey, resolvedSelectedVariant)
      }
      return
    }

    serverStorage.remove(STORAGE_KEY_SELECTED_MODEL)
  }, [resolvedModelKey, resolvedSelectedVariant, sessionId, sessionSelection])

  // 切换模型
  const handleModelChange = useCallback(
    (modelKey: string, _model: ModelInfo) => {
      // 先保存当前模型的 variant 偏好
      if (resolvedModelKey && resolvedSelectedVariant) {
        saveModelVariantPref(resolvedModelKey, resolvedSelectedVariant)
      }

      // 切换模型
      setSelection({
        selectedModelKey: modelKey,
        selectedVariant: getModelVariantPref(modelKey),
      })
    },
    [resolvedModelKey, resolvedSelectedVariant],
  )

  // Variant 变化时保存偏好
  const handleVariantChange = useCallback(
    (variant: string | undefined) => {
      setSelection(prev => ({ ...prev, selectedVariant: variant }))
      if (resolvedModelKey) {
        saveModelVariantPref(resolvedModelKey, variant)
      }
    },
    [resolvedModelKey],
  )

  // 从消息中恢复模型选择（仅更新内存状态，不写 storage）
  const restoreFromMessage = useCallback(
    (model: { providerID: string; modelID: string } | null | undefined, variant: string | null | undefined) => {
      if (!model) return

      const modelKey = `${model.providerID}:${model.modelID}`
      const exists = findModelByKey(models, modelKey)

      if (exists) {
        setSelection({
          selectedModelKey: modelKey,
          selectedVariant: variant ?? getModelVariantPref(modelKey),
        })
      }
    },
    [models],
  )

  return {
    selectedModelKey: resolvedModelKey,
    selectedVariant: resolvedSelectedVariant,
    currentModel,
    handleModelChange,
    handleVariantChange,
    restoreFromMessage,
  }
}
