import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY_MODEL_LABEL_FORMAT = 'model-label-format'

describe('themeStore modelLabelFormat', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('defaults modelLabelFormat to code', async () => {
    const { themeStore } = await import('./themeStore')

    expect(themeStore.getState().modelLabelFormat).toBe('code')
    expect(themeStore.modelLabelFormat).toBe('code')
  })

  it('restores persisted modelLabelFormat name', async () => {
    localStorage.setItem(STORAGE_KEY_MODEL_LABEL_FORMAT, 'name')

    const { themeStore } = await import('./themeStore')

    expect(themeStore.getState().modelLabelFormat).toBe('name')
  })

  it('falls back to code when persisted modelLabelFormat is invalid', async () => {
    localStorage.setItem(STORAGE_KEY_MODEL_LABEL_FORMAT, 'invalid-value')

    const { themeStore } = await import('./themeStore')

    expect(themeStore.getState().modelLabelFormat).toBe('code')
  })

  it('persists and emits when setting modelLabelFormat', async () => {
    const { themeStore } = await import('./themeStore')
    const listener = vi.fn()
    const unsubscribe = themeStore.subscribe(listener)

    themeStore.setModelLabelFormat('name')

    expect(themeStore.getState().modelLabelFormat).toBe('name')
    expect(localStorage.getItem(STORAGE_KEY_MODEL_LABEL_FORMAT)).toBe('name')
    expect(listener).toHaveBeenCalledTimes(1)

    themeStore.setModelLabelFormat('name')

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
