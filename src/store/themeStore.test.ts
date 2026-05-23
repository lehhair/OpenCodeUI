import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY_MODEL_LABEL_FORMAT = 'model-label-format'
const STORAGE_KEY_SHOW_MODEL_VARIANT = 'show-model-variant'

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

describe('themeStore showModelVariant', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('defaults showModelVariant to false when storage is missing', async () => {
    const { themeStore } = await import('./themeStore')

    expect(themeStore.getState().showModelVariant).toBe(false)
    expect(themeStore.showModelVariant).toBe(false)
  })

  it('restores persisted showModelVariant using strict true parsing', async () => {
    localStorage.setItem(STORAGE_KEY_SHOW_MODEL_VARIANT, 'true')

    let module = await import('./themeStore')
    expect(module.themeStore.getState().showModelVariant).toBe(true)

    localStorage.clear()
    localStorage.setItem(STORAGE_KEY_SHOW_MODEL_VARIANT, '1')
    vi.resetModules()
    module = await import('./themeStore')

    expect(module.themeStore.getState().showModelVariant).toBe(false)
  })

  it('persists and emits when setting showModelVariant', async () => {
    const { themeStore } = await import('./themeStore')
    const listener = vi.fn()
    const unsubscribe = themeStore.subscribe(listener)

    themeStore.setShowModelVariant(true)

    expect(themeStore.getState().showModelVariant).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY_SHOW_MODEL_VARIANT)).toBe('true')
    expect(listener).toHaveBeenCalledTimes(1)

    themeStore.setShowModelVariant(true)

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
