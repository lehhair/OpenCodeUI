// ============================================
// SkillPanel - Skill 管理面板
// 显示所有可用 Skill，支持查看详情
// ============================================

import { memo, useState, useEffect, useCallback } from 'react'
import {
  TeachIcon,
  RetryIcon,
  SpinnerIcon,
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
} from './Icons'
import { getSkills } from '../api/skill'
import type { Skill } from '../types/api/skill'
import { useDirectory } from '../hooks'

// ============================================
// SkillPanel Component
// ============================================

interface SkillPanelProps {
  isResizing?: boolean
}

export const SkillPanel = memo(function SkillPanel({ isResizing: _isResizing }: SkillPanelProps) {
  const { currentDirectory } = useDirectory()
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const loadSkills = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getSkills(currentDirectory)
      setSkills(data)
    } catch (err) {
      console.error('[SkillPanel] Failed to load skills:', err)
      setError('Failed to load skills')
    } finally {
      setLoading(false)
    }
  }, [currentDirectory])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  // Filter skills
  const filteredSkills = skills.filter(skill => 
    skill.name.toLowerCase().includes(filter.toLowerCase()) || 
    skill.description.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full bg-bg-100">
      {/* Header */}
      <div className="flex flex-col border-b border-border-100">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2 text-text-100 text-sm font-medium">
            <TeachIcon size={14} />
            <span>Skills</span>
            {!loading && (
              <span className="text-text-400 text-xs">({skills.length})</span>
            )}
          </div>
          <button
            onClick={loadSkills}
            disabled={loading}
            className="p-1 hover:bg-bg-200 rounded text-text-300 hover:text-text-100 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RetryIcon size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        
        {/* Search Bar */}
        <div className="px-3 pb-2">
          <div className="relative">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter skills..."
              className="w-full pl-8 pr-2 py-1 text-xs bg-bg-200/50 border border-transparent focus:border-border-200 rounded text-text-100 placeholder-text-400 focus:outline-none transition-colors"
            />
            <SearchIcon size={12} className="absolute left-2.5 top-1.5 text-text-400" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-sm gap-2">
            <SpinnerIcon size={20} className="animate-spin opacity-50" />
            <span>Loading skills...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-sm gap-2">
            <AlertCircleIcon size={20} className="text-danger-100" />
            <span>{error}</span>
            <button
              onClick={loadSkills}
              className="px-3 py-1.5 text-xs bg-bg-200/50 hover:bg-bg-200 text-text-200 rounded-md transition-colors"
            >
              Retry
            </button>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-sm gap-2 px-4 text-center">
            <TeachIcon size={24} className="opacity-30" />
            <span>No skills found</span>
          </div>
        ) : (
          <div className="divide-y divide-border-100">
            {filteredSkills.map((skill) => (
              <SkillItem key={skill.name} skill={skill} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

// ============================================
// SkillItem Component
// ============================================

const SkillItem = memo(function SkillItem({ skill }: { skill: Skill }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="group">
      <div
        className="flex items-start gap-2 px-3 py-2 hover:bg-bg-200/50 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-text-400 shrink-0 mt-0.5">
          {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </span>
        
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-100 font-medium">{skill.name}</div>
          <div className="text-xs text-text-400 truncate">{skill.description}</div>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-0 ml-5 border-l-2 border-border-200/30 pl-3">
          <div className="text-xs text-text-500 mb-2 font-mono break-all">
            {skill.location}
          </div>
          <div className="bg-bg-200/50 rounded p-2 overflow-x-auto">
            <pre className="text-xs text-text-200 font-mono whitespace-pre-wrap break-words">
              {skill.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
})
