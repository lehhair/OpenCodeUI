import { MS_PER_MINUTE, MS_PER_HOUR, MS_PER_DAY } from '../constants'

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return ''
  
  const now = Date.now()
  const diff = now - timestamp
  
  const minutes = Math.floor(diff / MS_PER_MINUTE)
  const hours = Math.floor(diff / MS_PER_HOUR)
  const days = Math.floor(diff / MS_PER_DAY)
  
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  
  return new Date(timestamp).toLocaleDateString()
}
