// ============================================
// WSL 添加服务器视图模型核心契约测试
// 对齐官方 packages/app/src/wsl/settings-model.test.ts 的关键场景
// ============================================

import { describe, expect, it } from 'vitest'
import {
  addableProbePlan,
  addServerProbePlan,
  addServerViewModel,
  createProbeFailureGate,
  isWslServerId,
  wslDistroReady,
} from './settings-model'
import type { WslDistroProbe, WslServersState } from './types'

const probe = (over: Partial<WslDistroProbe> = {}): WslDistroProbe => ({
  name: 'Ubuntu',
  canExecute: true,
  hasBash: true,
  hasCurl: true,
  error: null,
  ...over,
})

const baseState = (over: Partial<WslServersState> = {}): WslServersState => ({
  runtime: { available: true, version: '2.6.2', error: null },
  installed: [{ name: 'Ubuntu', version: 2, isDefault: true }],
  online: [],
  distroProbes: {},
  opencodeChecks: {},
  pendingRestart: false,
  servers: [],
  job: null,
  ...over,
})

describe('addServerDistroStatus (via addServerViewModel)', () => {
  it('ready probe + opencode check → ready', () => {
    const state = baseState({
      distroProbes: { Ubuntu: probe() },
      opencodeChecks: {
        Ubuntu: {
          distro: 'Ubuntu',
          resolvedPath: '/home/u/.opencode/bin/opencode',
          version: '1.0.0',
          expectedVersion: null,
          matchesDesktop: null,
          error: null,
        },
      },
    })
    const model = addServerViewModel({ state, view: 'main', selectedDistro: null, catalogSearch: '', catalogTarget: null, adding: false, probingAddable: false })
    expect(model.distroStatuses['Ubuntu']?.label.key).toBe('wsl.onboarding.distroStatus.ready')
    expect(model.distroStatuses['Ubuntu']?.tone).toBe('success')
  })

  it('probe exists but canExecute=false → openDistroOnce（不能用 undefined 误判）', () => {
    // 回归：serde 字段名不匹配曾使 canExecute 恒为 undefined
    const state = baseState({ distroProbes: { Ubuntu: probe({ canExecute: false, error: 'timed out' }) } })
    const model = addServerViewModel({ state, view: 'main', selectedDistro: null, catalogSearch: '', catalogTarget: null, adding: false, probingAddable: false })
    expect(model.distroStatuses['Ubuntu']?.label.key).toBe('wsl.onboarding.openDistroOnce')
  })

  it('probe missing + probing → checking；probe missing + idle → undefined', () => {
    const probing = addServerViewModel({ state: baseState(), view: 'main', selectedDistro: null, catalogSearch: '', catalogTarget: null, adding: false, probingAddable: true })
    expect(probing.distroStatuses['Ubuntu']?.label.key).toBe('wsl.onboarding.distroStatus.checking')
    const idle = addServerViewModel({ state: baseState(), view: 'main', selectedDistro: null, catalogSearch: '', catalogTarget: null, adding: false, probingAddable: false })
    expect(idle.distroStatuses['Ubuntu']).toBeUndefined()
  })

  it('missing bash → missingTools', () => {
    const state = baseState({ distroProbes: { Ubuntu: probe({ hasBash: false }) } })
    const model = addServerViewModel({ state, view: 'main', selectedDistro: null, catalogSearch: '', catalogTarget: null, adding: false, probingAddable: false })
    expect(model.distroStatuses['Ubuntu']?.label.key).toBe('wsl.onboarding.distroStatus.missingTools')
  })

  it('opencode check without resolvedPath → opencodeMissing', () => {
    const state = baseState({
      distroProbes: { Ubuntu: probe() },
      opencodeChecks: { Ubuntu: { distro: 'Ubuntu', resolvedPath: null, version: null, expectedVersion: null, matchesDesktop: null, error: 'opencode is not installed' } },
    })
    const model = addServerViewModel({ state, view: 'main', selectedDistro: null, catalogSearch: '', catalogTarget: null, adding: false, probingAddable: false })
    expect(model.distroStatuses['Ubuntu']?.label.key).toBe('wsl.onboarding.distroStatus.opencodeMissing')
  })

  it('primaryButton: ready 全链路 → add；缺 opencode → install-opencode', () => {
    const ready = addServerViewModel({
      state: baseState({
        distroProbes: { Ubuntu: probe() },
        opencodeChecks: { Ubuntu: { distro: 'Ubuntu', resolvedPath: '/bin/oc', version: '1.0.0', expectedVersion: null, matchesDesktop: null, error: null } },
      }),
      view: 'main', selectedDistro: null, catalogSearch: '', catalogTarget: null, adding: false, probingAddable: false,
    })
    expect(ready.primaryButton.action).toBe('add')

    const missing = addServerViewModel({
      state: baseState({
        distroProbes: { Ubuntu: probe() },
        opencodeChecks: { Ubuntu: { distro: 'Ubuntu', resolvedPath: null, version: null, expectedVersion: null, matchesDesktop: null, error: 'not installed' } },
      }),
      view: 'main', selectedDistro: null, catalogSearch: '', catalogTarget: null, adding: false, probingAddable: false,
    })
    expect(missing.primaryButton.action).toBe('install-opencode')
  })
})

describe('probe plans', () => {
  it('addableProbePlan 只计划未探测/未检查的 distro', () => {
    const state = baseState({ distroProbes: { Ubuntu: probe() } })
    const plan = addableProbePlan({ state, view: 'main', adding: false, selectedDistro: null, addableInstalledDistros: state.installed })
    // probe 就绪但缺 opencode check → 计划 opencode 检查
    expect(plan?.key).toBe('opencode:Ubuntu')

    const done = baseState({
      distroProbes: { Ubuntu: probe() },
      opencodeChecks: { Ubuntu: { distro: 'Ubuntu', resolvedPath: '/bin/oc', version: '1', expectedVersion: null, matchesDesktop: null, error: null } },
    })
    expect(addableProbePlan({ state: done, view: 'main', adding: false, selectedDistro: null, addableInstalledDistros: done.installed })).toBeUndefined()
  })

  it('autoProbePlan：无 runtime → probeRuntime；runtime 可用且无列表 → refreshDistros', () => {
    const plan = addServerProbePlan({ state: baseState({ runtime: null }), view: 'main', adding: false, busy: false, selectedDistro: null, addableInstalledDistros: [] })
    expect(plan?.key).toBe('auto:runtime')
    const distros = addServerProbePlan({ state: baseState({ installed: [] }), view: 'main', adding: false, busy: false, selectedDistro: null, addableInstalledDistros: [] })
    expect(distros?.key).toBe('auto:distros')
  })

  it('wslDistroReady 要求 WSL2 + 三项能力齐备', () => {
    const state = baseState({ distroProbes: { Ubuntu: probe() } })
    expect(wslDistroReady(state, 'Ubuntu')).toBe(true)
    const wsl1 = baseState({ installed: [{ name: 'Ubuntu', version: 1, isDefault: true }], distroProbes: { Ubuntu: probe() } })
    expect(wslDistroReady(wsl1, 'Ubuntu')).toBe(false)
  })
})

describe('distrosChecking', () => {
  const vm = (state: WslServersState) =>
    addServerViewModel({ state, view: 'main', selectedDistro: null, catalogSearch: '', catalogTarget: null, adding: false, probingAddable: false })

  it('distros job 在途 → true；其他 job / 无 job → false', () => {
    expect(vm(baseState({ installed: [], job: { kind: 'distros', startedAt: 0 } })).distrosChecking).toBe(true)
    expect(vm(baseState({ installed: [], job: { kind: 'runtime', startedAt: 0 } })).distrosChecking).toBe(false)
    expect(vm(baseState({ installed: [] })).distrosChecking).toBe(false)
  })
})

describe('createProbeFailureGate', () => {
  it('同 key 失败后拒绝，reset 后放行；成功不影响', () => {
    const gate = createProbeFailureGate()
    expect(gate.accepts('a')).toBe(true)
    gate.settle('a', new Error('timeout'))
    expect(gate.accepts('a')).toBe(false)
    expect(gate.accepts('b')).toBe(true)
    gate.settle('a') // 成功 settle 不记录失败
    gate.reset()
    expect(gate.accepts('a')).toBe(true)
  })
})

describe('isWslServerId', () => {
  // 后端确定性 id 约定：wsl:<distro>
  it('识别 wsl: 前缀，排除普通服务器 id', () => {
    expect(isWslServerId('wsl:Ubuntu-22.04')).toBe(true)
    expect(isWslServerId('some-local-server')).toBe(false)
  })
})
