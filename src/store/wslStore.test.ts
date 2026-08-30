import { describe, expect, it } from 'vitest'
import { reduceWslRestore, resolveWslBootTarget, type WslRestoreState } from './wslStore'

// 启动/恢复判定都是纯函数：不需要 mock Tauri，只验证判定契约
describe('resolveWslBootTarget', () => {
  it('prefers the wsl default server preference over the boot intent', () => {
    expect(resolveWslBootTarget({ defaultServerId: 'wsl:Ubuntu', bootIntentServerId: 'wsl:Debian' })).toBe('wsl:Ubuntu')
  })

  it('falls back to the boot intent server when there is no default preference', () => {
    expect(resolveWslBootTarget({ defaultServerId: null, bootIntentServerId: 'wsl:Debian' })).toBe('wsl:Debian')
  })

  it('ignores non-wsl ids from both sources', () => {
    expect(resolveWslBootTarget({ defaultServerId: 'remote', bootIntentServerId: 'local' })).toBeNull()
  })

  it('returns null when neither source is set', () => {
    expect(resolveWslBootTarget({ defaultServerId: null, bootIntentServerId: null })).toBeNull()
  })
})

const IDLE: WslRestoreState = { bootTarget: null, pendingRestoreId: null }

describe('reduceWslRestore', () => {
  it('records the active server as pending restore when it goes unready (died)', () => {
    const outcome = reduceWslRestore(IDLE, { kind: 'unready', serverId: 'wsl:Ubuntu', isActive: true })

    expect(outcome.state.pendingRestoreId).toBe('wsl:Ubuntu')
    expect(outcome.shouldRestore).toBe(false)
  })

  it('does not record when a non-active server goes unready', () => {
    const outcome = reduceWslRestore(IDLE, { kind: 'unready', serverId: 'wsl:Ubuntu', isActive: false })

    expect(outcome.state).toEqual(IDLE)
  })

  it('overwrites the pending restore with the most recent active death', () => {
    const first = reduceWslRestore(IDLE, { kind: 'unready', serverId: 'wsl:Ubuntu', isActive: true })
    const outcome = reduceWslRestore(first.state, { kind: 'unready', serverId: 'wsl:Debian', isActive: true })

    expect(outcome.state.pendingRestoreId).toBe('wsl:Debian')
  })

  it('restores a revived server that was active before it died', () => {
    const died = reduceWslRestore(IDLE, { kind: 'unready', serverId: 'wsl:Ubuntu', isActive: true })
    const outcome = reduceWslRestore(died.state, { kind: 'ready', serverId: 'wsl:Ubuntu', isActive: false })

    expect(outcome.shouldRestore).toBe(true)
    expect(outcome.state.pendingRestoreId).toBeNull()
  })

  it('does not restore when the revived server is already active but still consumes the memory', () => {
    const died = reduceWslRestore(IDLE, { kind: 'unready', serverId: 'wsl:Ubuntu', isActive: true })
    const outcome = reduceWslRestore(died.state, { kind: 'ready', serverId: 'wsl:Ubuntu', isActive: true })

    expect(outcome.shouldRestore).toBe(false)
    expect(outcome.state.pendingRestoreId).toBeNull()
  })

  it('restores and consumes the one-shot boot target when it becomes ready', () => {
    const state: WslRestoreState = { bootTarget: 'wsl:Ubuntu', pendingRestoreId: null }
    const outcome = reduceWslRestore(state, { kind: 'ready', serverId: 'wsl:Ubuntu', isActive: false })

    expect(outcome.shouldRestore).toBe(true)
    expect(outcome.state.bootTarget).toBeNull()
  })

  it('does not consume the boot target when a different server becomes ready', () => {
    const state: WslRestoreState = { bootTarget: 'wsl:Ubuntu', pendingRestoreId: 'wsl:Debian' }
    const outcome = reduceWslRestore(state, { kind: 'ready', serverId: 'wsl:Debian', isActive: false })

    expect(outcome.shouldRestore).toBe(true)
    expect(outcome.state.bootTarget).toBe('wsl:Ubuntu')
    expect(outcome.state.pendingRestoreId).toBeNull()
  })

  it('keeps the boot target across unready events of other servers', () => {
    const state: WslRestoreState = { bootTarget: 'wsl:Ubuntu', pendingRestoreId: null }
    const outcome = reduceWslRestore(state, { kind: 'unready', serverId: 'wsl:Debian', isActive: false })

    expect(outcome.state.bootTarget).toBe('wsl:Ubuntu')
    expect(outcome.shouldRestore).toBe(false)
  })

  it('consumes both memories when the same server hits boot target and pending restore', () => {
    const state: WslRestoreState = { bootTarget: 'wsl:Ubuntu', pendingRestoreId: 'wsl:Ubuntu' }
    const outcome = reduceWslRestore(state, { kind: 'ready', serverId: 'wsl:Ubuntu', isActive: false })

    expect(outcome.shouldRestore).toBe(true)
    expect(outcome.state).toEqual({ bootTarget: null, pendingRestoreId: null })
  })
})
