import { useState, useEffect, useCallback } from 'react'
import { getCurrentProject, getProjects, type ApiProject } from '../api'
import { apiErrorHandler } from '../utils'

export interface UseProjectResult {
  // 当前选中的 project
  currentProject: ApiProject | null
  // 所有可用的 projects
  projects: ApiProject[]
  // 加载状态
  isLoading: boolean
  // 错误信息
  error: string | null
  // 选择一个 project
  selectProject: (projectId: string) => void
  // 刷新项目列表
  refresh: () => Promise<void>
}

const STORAGE_KEY = 'selected-project-id'

export function useProject(): UseProjectResult {
  const [currentProject, setCurrentProject] = useState<ApiProject | null>(null)
  const [projects, setProjects] = useState<ApiProject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 加载项目列表
  const loadProjects = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // 并行获取当前项目和所有项目
      const [current, all] = await Promise.all([
        getCurrentProject(),
        getProjects(),
      ])

      setProjects(all)

      // 检查 localStorage 中是否有保存的选择
      const savedProjectId = localStorage.getItem(STORAGE_KEY)
      
      if (savedProjectId) {
        // 尝试找到保存的项目
        const savedProject = all.find(p => p.id === savedProjectId)
        if (savedProject) {
          setCurrentProject(savedProject)
        } else {
          // 保存的项目不存在了，用当前项目
          setCurrentProject(current)
          localStorage.removeItem(STORAGE_KEY)
        }
      } else {
        // 没有保存的，用当前项目
        setCurrentProject(current)
      }
    } catch (e) {
      apiErrorHandler('load projects', e)
      setError(e instanceof Error ? e.message : 'Failed to load projects')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 初始加载
  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // 选择项目
  const selectProject = useCallback((projectId: string) => {
    const project = projects.find(p => p.id === projectId)
    if (project) {
      setCurrentProject(project)
      localStorage.setItem(STORAGE_KEY, projectId)
    }
  }, [projects])

  return {
    currentProject,
    projects,
    isLoading,
    error,
    selectProject,
    refresh: loadProjects,
  }
}
