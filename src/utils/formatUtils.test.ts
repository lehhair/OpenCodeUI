import { describe, expect, it } from 'vitest'
import { formatCompletedAt, formatDateTime, formatDuration, formatTime } from './formatUtils'

describe('formatDuration', () => {
  it('formats milliseconds and seconds', () => {
    expect(formatDuration(999)).toBe('999ms')
    expect(formatDuration(1500)).toBe('1.5s')
  })

  it('formats minute and second durations', () => {
    expect(formatDuration((3 * 60 + 12) * 1000)).toBe('3m 12s')
  })

  it('formats hour durations as hours, minutes, and seconds', () => {
    expect(formatDuration((1 * 60 * 60 + 21 * 60 + 12) * 1000)).toBe('1h 21m 12s')
    expect(formatDuration(60 * 60 * 1000)).toBe('1h')
  })

  it('formats day durations as days, hours, and minutes', () => {
    expect(formatDuration(((24 + 21) * 60 + 10) * 60 * 1000)).toBe('1d 21h 10m')
    expect(formatDuration(24 * 60 * 60 * 1000)).toBe('1d')
  })
})

describe('completed time formatting', () => {
  it('formats local time as HH:MM', () => {
    const ms = new Date(2026, 3, 17, 10, 30, 45).getTime()
    expect(formatTime(ms)).toBe('10:30')
  })

  it('formats local date and time as YYYY-MM-DD HH:MM', () => {
    const ms = new Date(2026, 3, 17, 10, 30, 45).getTime()
    expect(formatDateTime(ms)).toBe('2026-04-17 10:30')
  })

  it('switches output based on completedAt format', () => {
    const ms = new Date(2026, 3, 17, 10, 30, 45).getTime()
    expect(formatCompletedAt(ms, 'time')).toBe('10:30')
    expect(formatCompletedAt(ms, 'dateTime')).toBe('2026-04-17 10:30')
  })
})
