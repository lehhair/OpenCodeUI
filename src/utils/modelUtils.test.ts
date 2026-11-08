import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Model } from '../api'

const { storage } = vi.hoisted(() => ({ storage: new Map<string, string>() }))

vi.mock('./perServerStorage', () => ({
  serverStorage: {
    get: (key: string) => storage.get(key) ?? null,
    set: (key: string, value: string) => {
      storage.set(key, value)
    },
    remove: (key: string) => {
      storage.delete(key)
    },
  },
}))

import { groupModelsByProvider, sortModelsByFrequency } from './modelUtils'

function model(id: string, name: string, providerID = 'p1'): Model {
  return { id, name, providerID } as unknown as Model
}

function setUsageStats(stats: Record<string, { count: number; lastUsed: number }>) {
  storage.set('model-usage-stats', JSON.stringify(stats))
}

describe('sortModelsByFrequency', () => {
  beforeEach(() => {
    storage.clear()
  })

  it('sorts unused models by model name', () => {
    const models = [model('c', 'Zeta'), model('a', 'Alpha'), model('b', 'Beta')]

    expect(sortModelsByFrequency(models).map(m => m.name)).toEqual(['Alpha', 'Beta', 'Zeta'])
  })

  it('puts used models before unused ones, with unused sorted by name', () => {
    setUsageStats({ 'p1:zulu': { count: 1, lastUsed: 100 } })
    const models = [model('zulu', 'Zulu'), model('beta', 'Beta'), model('alpha', 'Alpha')]

    expect(sortModelsByFrequency(models).map(m => m.name)).toEqual(['Zulu', 'Alpha', 'Beta'])
  })

  it('sorts used models by count desc, then lastUsed desc, then name', () => {
    setUsageStats({
      'p1:a': { count: 2, lastUsed: 100 },
      'p1:b': { count: 2, lastUsed: 200 },
      'p1:c': { count: 5, lastUsed: 1 },
      'p1:d': { count: 2, lastUsed: 200 },
    })
    const models = [model('a', 'Alpha'), model('b', 'Beta'), model('c', 'Gamma'), model('d', 'Delta')]

    expect(sortModelsByFrequency(models).map(m => m.name)).toEqual(['Gamma', 'Beta', 'Delta', 'Alpha'])
  })
})

describe('groupModelsByProvider', () => {
  beforeEach(() => {
    storage.clear()
  })

  it('keeps provider groups by total usage and sorts unused models by name within groups', () => {
    setUsageStats({ 'p2:x': { count: 3, lastUsed: 100 } })
    const models = [
      model('y', 'Yellow', 'p2'),
      model('z', 'Zeta', 'p1'),
      model('x', 'Xray', 'p2'),
      model('a', 'Alpha', 'p1'),
    ]

    const groups = groupModelsByProvider(models)

    expect(groups.map(group => group.providerName)).toEqual(['p2', 'p1'])
    expect(groups[0].models.map(m => m.name)).toEqual(['Xray', 'Yellow'])
    expect(groups[1].models.map(m => m.name)).toEqual(['Alpha', 'Zeta'])
  })
})
