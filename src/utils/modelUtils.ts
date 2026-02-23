/**
 * 模型工具函数
 * - 唯一标识管理
 * - 使用频率记录和排序
 */

import type { ModelInfo } from '../api'
import { serverStorage } from './perServerStorage'

// ============================================
// 模型唯一标识
// ============================================

/**
 * 生成模型的唯一标识符
 * 格式: providerId:modelId
 */
export function getModelKey(model: ModelInfo): string {
  return `${model.providerId}:${model.id}`
}

/**
 * 从唯一标识符解析 providerId 和 modelId
 */
export function parseModelKey(key: string): { providerId: string; modelId: string } | null {
  const idx = key.indexOf(':')
  if (idx === -1) return null
  return {
    providerId: key.slice(0, idx),
    modelId: key.slice(idx + 1)
  }
}

/**
 * 根据 key 找到对应的模型
 */
export function findModelByKey(models: ModelInfo[], key: string): ModelInfo | undefined {
  const parsed = parseModelKey(key)
  if (!parsed) return undefined
  return models.find(m => m.providerId === parsed.providerId && m.id === parsed.modelId)
}

// ============================================
// 使用频率存储
// ============================================

const STORAGE_KEY = 'model-usage-stats'
const VARIANT_STORAGE_KEY = 'model-variant-prefs'
const PINNED_STORAGE_KEY = 'model-pinned'

interface ModelUsageStats {
  [modelKey: string]: {
    count: number
    lastUsed: number
  }
}

interface ModelVariantPrefs {
  [modelKey: string]: string  // modelKey -> variant
}

/**
 * 获取所有模型的使用统计
 */
export function getModelUsageStats(): ModelUsageStats {
  try {
    const stored = serverStorage.get(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

/**
 * 记录模型使用
 */
export function recordModelUsage(model: ModelInfo): void {
  const key = getModelKey(model)
  const stats = getModelUsageStats()
  
  if (!stats[key]) {
    stats[key] = { count: 0, lastUsed: 0 }
  }
  
  stats[key].count += 1
  stats[key].lastUsed = Date.now()
  
  try {
    serverStorage.set(STORAGE_KEY, JSON.stringify(stats))
  } catch (e) {
    console.warn('Failed to save model usage stats:', e)
  }
}

/**
 * 获取模型的使用次数
 */
export function getModelUsageCount(model: ModelInfo): number {
  const key = getModelKey(model)
  const stats = getModelUsageStats()
  return stats[key]?.count ?? 0
}

// ============================================
// Variant 偏好存储
// ============================================

/**
 * 获取所有模型的 variant 偏好
 */
export function getModelVariantPrefs(): ModelVariantPrefs {
  try {
    const stored = serverStorage.get(VARIANT_STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

/**
 * 保存模型的 variant 偏好
 */
export function saveModelVariantPref(modelKey: string, variant: string | undefined): void {
  const prefs = getModelVariantPrefs()
  
  if (variant) {
    prefs[modelKey] = variant
  } else {
    delete prefs[modelKey]
  }
  
  try {
    serverStorage.set(VARIANT_STORAGE_KEY, JSON.stringify(prefs))
  } catch (e) {
    console.warn('Failed to save model variant pref:', e)
  }
}

/**
 * 获取模型的 variant 偏好
 */
export function getModelVariantPref(modelKey: string): string | undefined {
  const prefs = getModelVariantPrefs()
  return prefs[modelKey]
}

// ============================================
// 模型排序
// ============================================

export type ModelSortMode = 'frequency' | 'alphabetical' | 'provider'

/**
 * 根据使用频率排序模型
 * - 最近使用的优先
 * - 使用次数多的优先
 * - 未使用过的按原始顺序
 */
export function sortModelsByFrequency(models: ModelInfo[]): ModelInfo[] {
  const stats = getModelUsageStats()
  
  return [...models].sort((a, b) => {
    const keyA = getModelKey(a)
    const keyB = getModelKey(b)
    const statsA = stats[keyA]
    const statsB = stats[keyB]
    
    // 都没使用过，保持原始顺序
    if (!statsA && !statsB) return 0
    
    // 只有一个使用过，使用过的排前面
    if (!statsA) return 1
    if (!statsB) return -1
    
    // 都使用过，按使用次数排序，次数相同按最近使用时间
    if (statsA.count !== statsB.count) {
      return statsB.count - statsA.count
    }
    return statsB.lastUsed - statsA.lastUsed
  })
}

/**
 * 按字母顺序排序模型
 */
export function sortModelsAlphabetically(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 按 provider 分组（返回分组后的扁平数组，常用的 provider 在前）
 */
export function sortModelsByProvider(models: ModelInfo[]): ModelInfo[] {
  const stats = getModelUsageStats()
  
  // 计算每个 provider 的总使用次数
  const providerUsage: Record<string, number> = {}
  for (const model of models) {
    const key = getModelKey(model)
    const count = stats[key]?.count ?? 0
    providerUsage[model.providerId] = (providerUsage[model.providerId] ?? 0) + count
  }
  
  // 按 provider 使用频率分组
  const groups = models.reduce((acc, model) => {
    if (!acc[model.providerId]) {
      acc[model.providerId] = []
    }
    acc[model.providerId].push(model)
    return acc
  }, {} as Record<string, ModelInfo[]>)
  
  // 按 provider 使用频率排序
  const sortedProviders = Object.keys(groups).sort((a, b) => {
    return (providerUsage[b] ?? 0) - (providerUsage[a] ?? 0)
  })
  
  // 扁平化，每个 provider 内部按使用频率排序
  return sortedProviders.flatMap(providerId => 
    sortModelsByFrequency(groups[providerId])
  )
}

// ============================================
// 模型分组（用于 UI 展示）
// ============================================

export interface ModelGroup {
  providerId: string
  providerName: string
  models: ModelInfo[]
}

/**
 * 将模型按 provider 分组，常用的 provider 在前
 */
export function groupModelsByProvider(models: ModelInfo[]): ModelGroup[] {
  const stats = getModelUsageStats()
  
  // 按 providerName 分组 (合并同名 Provider)
  const groupMap = models.reduce((acc, model) => {
    const key = model.providerName // 使用 Name 作为分组键
    if (!acc[key]) {
      acc[key] = {
        providerId: model.providerId, // 这里的 ID 仅作参考，可能不唯一
        providerName: model.providerName,
        models: []
      }
    }
    acc[key].models.push(model)
    return acc
  }, {} as Record<string, ModelGroup>)
  
  // 按 provider 使用频率排序 (累加该 Name 下所有模型的使用次数)
  const groups = Object.values(groupMap).sort((a, b) => {
    // 计算 Group A 的总权重
    const weightA = a.models.reduce((sum, m) => sum + (stats[getModelKey(m)]?.count ?? 0), 0)
    // 计算 Group B 的总权重
    const weightB = b.models.reduce((sum, m) => sum + (stats[getModelKey(m)]?.count ?? 0), 0)
    
    return weightB - weightA
  })
  
  // 每个 provider 内部按使用频率排序
  for (const group of groups) {
    group.models = sortModelsByFrequency(group.models)
  }
  
  return groups
}

/**
 * 获取最近使用的模型列表（用于快速访问）
 */
export function getRecentModels(models: ModelInfo[], limit = 5): ModelInfo[] {
  const stats = getModelUsageStats()
  
  // 过滤出使用过的模型并按最近使用时间排序
  // 只要有记录且 count > 0 就视为使用过
  const usedModels = models
    .filter(m => {
      const s = stats[getModelKey(m)]
      return s && (s.count > 0 || s.lastUsed > 0)
    })
    .sort((a, b) => {
      const statsA = stats[getModelKey(a)]
      const statsB = stats[getModelKey(b)]
      // 优先按时间倒序
      return (statsB?.lastUsed ?? 0) - (statsA?.lastUsed ?? 0)
    })
  
  return usedModels.slice(0, limit)
}

// ============================================
// 模型置顶
// ============================================

/**
 * 获取所有置顶的模型 key 列表（有序）
 */
export function getPinnedModelKeys(): string[] {
  try {
    const stored = serverStorage.get(PINNED_STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

/**
 * 判断模型是否已置顶
 */
export function isModelPinned(model: ModelInfo): boolean {
  const key = getModelKey(model)
  return getPinnedModelKeys().includes(key)
}

/**
 * 切换模型置顶状态
 */
export function toggleModelPin(model: ModelInfo): boolean {
  const key = getModelKey(model)
  const pinned = getPinnedModelKeys()
  const index = pinned.indexOf(key)
  let nowPinned: boolean

  if (index !== -1) {
    pinned.splice(index, 1)
    nowPinned = false
  } else {
    pinned.push(key)
    nowPinned = true
  }

  try {
    serverStorage.set(PINNED_STORAGE_KEY, JSON.stringify(pinned))
  } catch (e) {
    console.warn('Failed to save pinned models:', e)
  }
  return nowPinned
}

/**
 * 获取置顶模型列表（保持置顶顺序）
 */
export function getPinnedModels(models: ModelInfo[]): ModelInfo[] {
  const pinnedKeys = getPinnedModelKeys()
  if (pinnedKeys.length === 0) return []
  
  const keySet = new Set(pinnedKeys)
  const modelMap = new Map<string, ModelInfo>()
  for (const m of models) {
    const k = getModelKey(m)
    if (keySet.has(k)) modelMap.set(k, m)
  }
  
  // 保持置顶顺序
  return pinnedKeys
    .map(k => modelMap.get(k))
    .filter((m): m is ModelInfo => !!m)
}
