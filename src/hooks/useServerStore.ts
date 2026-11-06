// ============================================
// useServerStore - Server Store React Hook
// ============================================

import { useSyncExternalStore, useCallback } from 'react'
import {
  serverStore,
  subscribeServerStore,
  type ServerConfig,
  type ServerHealth,
  type EndpointRuntime,
} from '../store/serverStore'
export type { ServerConfig, ServerHealth, EndpointRuntime }

/**
 * 订阅 serverStore 的 React hook
 */
export function useServerStore() {
  const servers = useSyncExternalStore(
    subscribeServerStore,
    () => serverStore.getServers(),
    () => serverStore.getServers(),
  )

  const activeServer = useSyncExternalStore(
    subscribeServerStore,
    () => serverStore.getActiveServer(),
    () => serverStore.getActiveServer(),
  )

  const healthMap = useSyncExternalStore(
    subscribeServerStore,
    () => serverStore.getAllHealth(),
    () => serverStore.getAllHealth(),
  )

  // 启动默认服务器偏好（setDefaultServer 内部会 notify，这里能正常感知）
  const defaultServerId = useSyncExternalStore(
    subscribeServerStore,
    () => serverStore.getDefaultServerId(),
    () => serverStore.getDefaultServerId(),
  )

  // 多地址运行时状态（生效地址 / 锁定地址）
  const endpointStates = useSyncExternalStore(
    subscribeServerStore,
    () => serverStore.getEndpointStates(),
    () => serverStore.getEndpointStates(),
  )

  const addServer = useCallback((config: Omit<ServerConfig, 'id'>) => {
    return serverStore.addServer(config)
  }, [])

  const updateServer = useCallback((id: string, updates: Partial<Omit<ServerConfig, 'id'>>) => {
    return serverStore.updateServer(id, updates)
  }, [])

  const removeServer = useCallback((id: string) => {
    return serverStore.removeServer(id)
  }, [])

  const setActiveServer = useCallback((id: string) => {
    return serverStore.setActiveServer(id)
  }, [])

  const setActiveEndpoint = useCallback((serverId: string, url: string) => {
    return serverStore.setActiveEndpoint(serverId, url)
  }, [])

  const setLockedEndpoint = useCallback((serverId: string, url: string | null) => {
    return serverStore.setLockedEndpoint(serverId, url)
  }, [])

  const checkHealth = useCallback((serverId: string) => {
    return serverStore.checkHealth(serverId)
  }, [])

  const checkAllHealth = useCallback(() => {
    return serverStore.checkAllHealth()
  }, [])

  const getHealth = useCallback(
    (serverId: string): ServerHealth | null => {
      return healthMap.get(serverId) ?? null
    },
    [healthMap],
  )

  return {
    servers,
    activeServer,
    healthMap,
    defaultServerId,
    endpointStates,
    addServer,
    updateServer,
    removeServer,
    setActiveServer,
    setActiveEndpoint,
    setLockedEndpoint,
    checkHealth,
    checkAllHealth,
    getHealth,
  }
}
