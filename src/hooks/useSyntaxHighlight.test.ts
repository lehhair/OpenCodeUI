import { describe, expect, it } from 'vitest'
import { getShikiTheme } from './useSyntaxHighlight'

describe('getShikiTheme', () => {
  it('uses complete GitHub bundled themes by default', () => {
    expect(getShikiTheme(true).theme).toBe('github-dark-default')
    expect(getShikiTheme(false).theme).toBe('github-light-default')
  })

  it('keeps theme revision in cache keys', () => {
    expect(getShikiTheme(true, 'preset-a').key).toBe('github-dark-default:preset-a')
    expect(getShikiTheme(false, 'preset-a').key).toBe('github-light-default:preset-a')
    expect(getShikiTheme(true, 'preset-b').key).toBe('github-dark-default:preset-b')
  })
})
