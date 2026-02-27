// ============================================
// McpPanel - MCP 服务器管理面板
// 显示所有 MCP 服务器状态，支持连接/断开/认证
// 支持添加新服务器
// ============================================

import { memo, useState, useEffect, useCallback } from 'react'
import {
  PlugIcon,
  RetryIcon,
  KeyIcon,
  ExternalLinkIcon,
  AlertCircleIcon,
  CheckIcon,
  SpinnerIcon,
  PlusIcon,
  CloseIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from './Icons'
import {
  getMcpStatus,
  connectMcpServer,
  disconnectMcpServer,
  startMcpAuth,
  authenticateMcp,
  addMcpServer,
} from '../api/mcp'
import type { MCPStatus, McpServerConfig } from '../types/api/mcp'
import { useDirectory } from '../hooks'

// ============================================
// Types
// ============================================

interface ServerEntry {
  name: string
  status: MCPStatus
}

// ============================================
// McpPanel Component
// ============================================

interface McpPanelProps {
  isResizing?: boolean
}

export const McpPanel = memo(function McpPanel({ isResizing: _isResizing }: McpPanelProps) {
  const { currentDirectory } = useDirectory()
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  // 加载 MCP 状态
  const loadStatus = useCallback(async () => {
    try {
      setError(null)
      const statusResponse = await getMcpStatus(currentDirectory)
      console.log('[McpPanel] Status:', statusResponse)
      
      // 构建 server entries
      const entries: ServerEntry[] = Object.entries(statusResponse).map(([name, status]) => ({
        name,
        status: status as MCPStatus,
      }))
      
      // 按名称排序
      entries.sort((a, b) => a.name.localeCompare(b.name))
      setServers(entries)
    } catch (err) {
      console.error('[McpPanel] Failed to load MCP status:', err)
      setError('Failed to load MCP servers')
    } finally {
      setLoading(false)
    }
  }, [currentDirectory])

  // 初始加载
  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // 刷新
  const handleRefresh = useCallback(() => {
    setLoading(true)
    loadStatus()
  }, [loadStatus])

  // 连接服务器
  const handleConnect = useCallback(async (name: string) => {
    setActionLoading(name)
    try {
      await connectMcpServer(name, currentDirectory)
      // 等一下让后端处理完
      await new Promise(r => setTimeout(r, 500))
      await loadStatus()
    } catch (err) {
      console.error('[McpPanel] Failed to connect:', err)
    } finally {
      setActionLoading(null)
    }
  }, [currentDirectory, loadStatus])

  // 断开服务器
  const handleDisconnect = useCallback(async (name: string) => {
    setActionLoading(name)
    try {
      await disconnectMcpServer(name, currentDirectory)
      await new Promise(r => setTimeout(r, 500))
      await loadStatus()
    } catch (err) {
      console.error('[McpPanel] Failed to disconnect:', err)
    } finally {
      setActionLoading(null)
    }
  }, [currentDirectory, loadStatus])

  // 开始认证流程
  const handleAuth = useCallback(async (name: string) => {
    setActionLoading(name)
    try {
      // 尝试使用 authenticate 接口（自动打开浏览器）
      await authenticateMcp(name, currentDirectory)
      // 等待用户完成认证
      await new Promise(r => setTimeout(r, 3000))
      await loadStatus()
    } catch (err) {
      // 如果失败，尝试 startMcpAuth 获取 URL
      try {
        const result = await startMcpAuth(name, currentDirectory)
        window.open(result.url, '_blank', 'noopener,noreferrer')
        await new Promise(r => setTimeout(r, 3000))
        await loadStatus()
      } catch (err2) {
        console.error('[McpPanel] Failed to start auth:', err2)
      }
    } finally {
      setActionLoading(null)
    }
  }, [currentDirectory, loadStatus])

  // 添加新服务器
  const handleAddServer = useCallback(async (name: string, config: McpServerConfig) => {
    setActionLoading('__adding__')
    try {
      await addMcpServer(name, config, currentDirectory)
      setShowAddForm(false)
      await new Promise(r => setTimeout(r, 500))
      await loadStatus()
    } catch (err) {
      console.error('[McpPanel] Failed to add server:', err)
      throw err
    } finally {
      setActionLoading(null)
    }
  }, [currentDirectory, loadStatus])

  // ============================================
  // Render
  // ============================================

  return (
    <div className="flex flex-col h-full bg-bg-100">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-100">
        <div className="flex items-center gap-2 text-text-100 text-sm font-medium">
          <PlugIcon size={14} />
          <span>MCP Servers</span>
          {!loading && (
            <span className="text-text-400 text-xs">({servers.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowAddForm(true)}
            disabled={showAddForm}
            className="p-1 hover:bg-bg-200 rounded text-text-300 hover:text-text-100 transition-colors disabled:opacity-50"
            title="Add Server"
          >
            <PlusIcon size={14} />
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-1 hover:bg-bg-200 rounded text-text-300 hover:text-text-100 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RetryIcon size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Add Server Form */}
        {showAddForm && (
          <AddServerForm
            onSubmit={handleAddServer}
            onCancel={() => setShowAddForm(false)}
            isLoading={actionLoading === '__adding__'}
          />
        )}

        {loading && servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-sm gap-2">
            <SpinnerIcon size={20} className="animate-spin opacity-50" />
            <span>Loading servers...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-sm gap-2">
            <AlertCircleIcon size={20} className="text-danger-100" />
            <span>{error}</span>
            <button
              onClick={handleRefresh}
              className="px-3 py-1.5 text-xs bg-bg-200/50 hover:bg-bg-200 text-text-200 rounded-md transition-colors"
            >
              Retry
            </button>
          </div>
        ) : servers.length === 0 && !showAddForm ? (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-sm gap-2 px-4 text-center">
            <PlugIcon size={24} className="opacity-30" />
            <span>No MCP servers configured</span>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-3 py-1.5 text-xs bg-bg-200/50 hover:bg-bg-200 text-text-200 rounded-md transition-colors"
            >
              Add Server
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border-100">
            {servers.map((server) => (
              <ServerItem
                key={server.name}
                server={server}
                isLoading={actionLoading === server.name}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                onAuth={handleAuth}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

// ============================================
// AddServerForm Component
// ============================================

interface AddServerFormProps {
  onSubmit: (name: string, config: McpServerConfig) => Promise<void>
  onCancel: () => void
  isLoading: boolean
}

const AddServerForm = memo(function AddServerForm({
  onSubmit,
  onCancel,
  isLoading,
}: AddServerFormProps) {
  const [serverType, setServerType] = useState<'local' | 'remote'>('local')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Server name is required')
      return
    }

    try {
      if (serverType === 'local') {
        if (!command.trim()) {
          setError('Command is required')
          return
        }
        // 解析命令为数组
        const cmdParts = command.trim().split(/\s+/)
        await onSubmit(name.trim(), {
          type: 'local',
          command: cmdParts,
        })
      } else {
        if (!url.trim()) {
          setError('URL is required')
          return
        }
        await onSubmit(name.trim(), {
          type: 'remote',
          url: url.trim(),
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add server')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 border-b border-border-100 bg-bg-200/30">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-text-100">Add MCP Server</span>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 hover:bg-bg-200 rounded text-text-400 hover:text-text-100 transition-colors"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      {/* Server Type Toggle */}
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => setServerType('local')}
          className={`flex-1 px-3 py-1.5 text-xs rounded transition-colors ${
            serverType === 'local'
              ? 'bg-accent-main-100/20 text-accent-main-100 border border-accent-main-100/50'
              : 'bg-bg-200/50 text-text-300 border border-transparent hover:bg-bg-200'
          }`}
        >
          Local
        </button>
        <button
          type="button"
          onClick={() => setServerType('remote')}
          className={`flex-1 px-3 py-1.5 text-xs rounded transition-colors ${
            serverType === 'remote'
              ? 'bg-accent-main-100/20 text-accent-main-100 border border-accent-main-100/50'
              : 'bg-bg-200/50 text-text-300 border border-transparent hover:bg-bg-200'
          }`}
        >
          Remote
        </button>
      </div>

      {/* Name Input */}
      <div className="mb-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Server name"
          className="w-full px-2 py-1.5 text-xs bg-bg-100 border border-border-200 rounded text-text-100 placeholder-text-500 focus:outline-none focus:border-accent-main-100"
        />
      </div>

      {/* Local: Command Input */}
      {serverType === 'local' && (
        <div className="mb-2">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Command (e.g., npx -y @modelcontextprotocol/server-github)"
            className="w-full px-2 py-1.5 text-xs bg-bg-100 border border-border-200 rounded text-text-100 placeholder-text-500 focus:outline-none focus:border-accent-main-100"
          />
        </div>
      )}

      {/* Remote: URL Input */}
      {serverType === 'remote' && (
        <div className="mb-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Server URL (e.g., https://mcp.example.com)"
            className="w-full px-2 py-1.5 text-xs bg-bg-100 border border-border-200 rounded text-text-100 placeholder-text-500 focus:outline-none focus:border-accent-main-100"
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-2 text-xs text-danger-100">{error}</div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full px-3 py-1.5 text-xs bg-accent-main-100 hover:bg-accent-main-200 text-oncolor-100 rounded transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <SpinnerIcon size={12} className="animate-spin" />
            Adding...
          </>
        ) : (
          <>
            <PlusIcon size={12} />
            Add Server
          </>
        )}
      </button>
    </form>
  )
})

// ============================================
// ServerItem Component
// ============================================

interface ServerItemProps {
  server: ServerEntry
  isLoading: boolean
  onConnect: (name: string) => void
  onDisconnect: (name: string) => void
  onAuth: (name: string) => void
}

const ServerItem = memo(function ServerItem({
  server,
  isLoading,
  onConnect,
  onDisconnect,
  onAuth,
}: ServerItemProps) {
  const { name, status } = server
  const [expanded, setExpanded] = useState(false)
  
  // 获取错误信息（如果有）
  const getErrorMessage = (): string | null => {
    if (status.status === 'failed') {
      return status.error
    }
    if (status.status === 'needs_client_registration') {
      return status.error
    }
    return null
  }

  const errorMessage = getErrorMessage()

  // 状态颜色和标签
  const getStatusInfo = () => {
    switch (status.status) {
      case 'connected':
        return { color: 'text-success-100', label: 'Connected', icon: CheckIcon }
      case 'disabled':
        return { color: 'text-text-400', label: 'Disabled', icon: null }
      case 'failed':
        return { color: 'text-danger-100', label: 'Failed', icon: AlertCircleIcon }
      case 'needs_auth':
        return { color: 'text-warning-100', label: 'Needs Auth', icon: KeyIcon }
      case 'needs_client_registration':
        return { color: 'text-warning-100', label: 'Needs Registration', icon: KeyIcon }
      default:
        return { color: 'text-text-400', label: 'Unknown', icon: null }
    }
  }

  const statusInfo = getStatusInfo()
  const StatusIcon = statusInfo.icon

  // 渲染操作按钮
  const renderActions = () => {
    if (isLoading) {
      return (
        <SpinnerIcon size={14} className="animate-spin text-text-400" />
      )
    }

    switch (status.status) {
      case 'connected':
        return (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDisconnect(name)
            }}
            className="px-2 py-0.5 text-xs bg-bg-300/50 hover:bg-danger-bg hover:text-danger-100 text-text-300 rounded transition-colors"
          >
            Disconnect
          </button>
        )
      case 'disabled':
      case 'failed':
        return (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onConnect(name)
            }}
            className="px-2 py-0.5 text-xs bg-bg-300/50 hover:bg-success-bg hover:text-success-100 text-text-300 rounded transition-colors"
          >
            Connect
          </button>
        )
      case 'needs_auth':
      case 'needs_client_registration':
        return (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAuth(name)
            }}
            className="px-2 py-0.5 text-xs bg-warning-bg hover:bg-warning-bg/80 text-warning-100 rounded transition-colors flex items-center gap-1"
          >
            <ExternalLinkIcon size={10} />
            Authenticate
          </button>
        )
      default:
        return null
    }
  }

  // 状态指示器颜色
  const getStatusDotColor = () => {
    switch (status.status) {
      case 'connected': return 'bg-success-100'
      case 'disabled': return 'bg-text-500'
      case 'failed': return 'bg-danger-100'
      case 'needs_auth':
      case 'needs_client_registration':
        return 'bg-warning-100'
      default: return 'bg-text-500'
    }
  }

  return (
    <div className="group">
      {/* Main row */}
      <div 
        className="flex items-center gap-2 px-3 py-2 hover:bg-bg-200/50 transition-colors"
        onClick={() => errorMessage && setExpanded(!expanded)}
      >
        {/* Expand icon only if there is an error to show details for */}
        {errorMessage ? (
          <span className="text-text-400 shrink-0 cursor-pointer">
            {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Status indicator */}
        <div className={`w-2 h-2 rounded-full shrink-0 ${getStatusDotColor()}`} />

        {/* Server name */}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-100 truncate">{name}</div>
          <div className={`text-xs ${statusInfo.color} flex items-center gap-1`}>
            {StatusIcon && <StatusIcon size={10} />}
            <span>{statusInfo.label}</span>
            {errorMessage && !expanded && (
              <span className="text-text-500 ml-1 truncate max-w-[200px]" title={errorMessage}>
                - {errorMessage}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {renderActions()}
        </div>
      </div>

      {/* Expanded Error Details */}
      {expanded && errorMessage && (
        <div className="px-3 py-2 bg-danger-bg border-t border-danger-100/20 ml-5 text-xs text-text-200 break-words font-mono">
          {errorMessage}
        </div>
      )}
    </div>
  )
})
