// ============================================
// useModelSelection - 模型选择逻辑
// ============================================

import { useState, useCallback, useEffect } from 'react'
import type { ModelInfo } from '../api'
import { getModelKey, findModelByKey, saveModelVariantPref, getModelVariantPref } from '../utils/modelUtils'
import { STORAGE_KEY_SELECTED_MODEL } from '../constants'

interface UseModelSelectionOptions {
  models: ModelInfo[]
}

interface UseModelSelectionReturn {
  selectedModelKey: string | null
  selectedVariant: string | undefined
  currentModel: ModelInfo | undefined
  handleModelChange: (modelKey: string, model: ModelInfo) => void
  handleVariantChange: (variant: string | undefined) => void
  restoreFromMessage: (model: { providerID: string; modelID: string } | null | undefined, variant: string | null | undefined) => void
}

export function useModelSelection({ models }: UseModelSelectionOptions): UseModelSelectionReturn {
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY_SELECTED_MODEL)
  })
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)

  const currentModel = selectedModelKey ? findModelByKey(models, selectedModelKey) : undefined

  // 切换模型
  const handleModelChange = useCallback((modelKey: string, _model: ModelInfo) => {
    // 先保存当前模型的 variant 偏好
    if (selectedModelKey && selectedVariant) {
      saveModelVariantPref(selectedModelKey, selectedVariant)
    }
    
    // 切换模型
    setSelectedModelKey(modelKey)
    localStorage.setItem(STORAGE_KEY_SELECTED_MODEL, modelKey)
    
    // 恢复新模型的 variant 偏好
    const savedVariant = getModelVariantPref(modelKey)
    setSelectedVariant(savedVariant)
  }, [selectedModelKey, selectedVariant])

  // Variant 变化时保存偏好
  const handleVariantChange = useCallback((variant: string | undefined) => {
    setSelectedVariant(variant)
    if (selectedModelKey) {
      saveModelVariantPref(selectedModelKey, variant)
    }
  }, [selectedModelKey])

  // 从消息中恢复模型选择
  const restoreFromMessage = useCallback((
    model: { providerID: string; modelID: string } | null | undefined,
    variant: string | null | undefined
  ) => {
    if (!model) return
    
    const modelKey = `${model.providerID}:${model.modelID}`
    const exists = findModelByKey(models, modelKey)
    
    if (exists) {
      setSelectedModelKey(modelKey)
      setSelectedVariant(variant ?? undefined)
    }
  }, [models])

  // 初始化时恢复 variant 偏好
  useEffect(() => {
    if (selectedModelKey && selectedVariant === undefined) {
      const savedVariant = getModelVariantPref(selectedModelKey)
      if (savedVariant) {
        setSelectedVariant(savedVariant)
      }
    }
  }, [selectedModelKey])

  // 模型列表加载后自动选择
  useEffect(() => {
    if (models.length === 0) return
    if (selectedModelKey) {
      const exists = findModelByKey(models, selectedModelKey)
      if (!exists) {
        // 如果当前选中的模型不存在，选择第一个
        const firstModel = models[0]
        handleModelChange(getModelKey(firstModel), firstModel)
      }
    } else {
      // 没有选中模型时，选择第一个
      const firstModel = models[0]
      handleModelChange(getModelKey(firstModel), firstModel)
    }
  }, [models, selectedModelKey, handleModelChange])

  return {
    selectedModelKey,
    selectedVariant,
    currentModel,
    handleModelChange,
    handleVariantChange,
    restoreFromMessage,
  }
}
