// ============================================
// useBuiltinCommands - 内置斜杠命令注册表与执行
// ============================================
//
// 内置命令不通过 GET /command 返回，需要在前端硬编码注册。
// 每条记录包含：菜单展示元数据 + 执行逻辑。
// 调用方拿到 builtinCommands（用于菜单展示）和 executeBuiltin（用于命令分发）。

import { useCallback, useMemo } from 'react'
import { summarizeSession } from '../api'
import type { Command } from '../api/command'

// ============================================
// Types
// ============================================

export interface BuiltinCommandContext {
  /** 当前 session ID（requiresSession=false 时可为 null） */
  sessionId: string | null
  /** 当前选中的模型 */
  currentModel: { providerId: string; id: string } | undefined
  /** 有效工作目录 */
  effectiveDirectory: string
  /** 跳转到主页（清除路由中的 session） */
  navigateHome: () => void
  /** 清除 UI 层当前 session 状态 */
  handleNewChat: () => void
}

interface BuiltinCommandDef {
  /** 菜单展示数据 */
  meta: Command
  /** 执行前是否需要保证 session 已存在 */
  requiresSession: boolean
  /** 执行函数 */
  execute: (ctx: BuiltinCommandContext, args: string) => Promise<void>
}

// ============================================
// 注册表（静态定义，不依赖运行时状态）
// ============================================

const BUILTIN_COMMAND_DEFS: BuiltinCommandDef[] = [
  {
    meta: {
      name: 'compact',
      description: 'Compact session by summarizing conversation history',
    },
    requiresSession: true,
    execute: async (ctx) => {
      if (!ctx.currentModel) {
        throw new Error('No model selected')
      }
      await summarizeSession(
        ctx.sessionId!,
        { providerID: ctx.currentModel.providerId, modelID: ctx.currentModel.id },
        ctx.effectiveDirectory,
      )
    },
  },
  {
    meta: {
      name: 'new',
      description: 'Create a new session',
    },
    requiresSession: false,
    execute: async (ctx) => {
      ctx.navigateHome()
      ctx.handleNewChat()
    },
  },
]

// ============================================
// Hook
// ============================================

export interface UseBuiltinCommandsResult {
  /** 用于斜杠菜单展示的命令列表 */
  builtinCommands: Command[]
  /**
   * 按名称查找并执行一条内置命令。
   * 返回 true 表示找到并执行，false 表示不是内置命令（交给调用方走远端路由）。
   */
  executeBuiltin: (name: string, args: string, ctx: BuiltinCommandContext) => Promise<boolean>
  /** 判断某个命令名是否为内置命令 */
  isBuiltin: (name: string) => boolean
  /** 内置命令是否要求 session 存在 */
  requiresSession: (name: string) => boolean
}

export function useBuiltinCommands(): UseBuiltinCommandsResult {
  const builtinCommands = useMemo<Command[]>(
    () => BUILTIN_COMMAND_DEFS.map(d => d.meta),
    [],
  )

  const isBuiltin = useCallback(
    (name: string) => BUILTIN_COMMAND_DEFS.some(d => d.meta.name === name),
    [],
  )

  const requiresSession = useCallback(
    (name: string) => BUILTIN_COMMAND_DEFS.find(d => d.meta.name === name)?.requiresSession ?? true,
    [],
  )

  const executeBuiltin = useCallback(
    async (name: string, args: string, ctx: BuiltinCommandContext): Promise<boolean> => {
      const def = BUILTIN_COMMAND_DEFS.find(d => d.meta.name === name)
      if (!def) return false
      await def.execute(ctx, args)
      return true
    },
    [],
  )

  return { builtinCommands, executeBuiltin, isBuiltin, requiresSession }
}
