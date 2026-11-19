import { describe, expect, it } from 'vitest'
import { BoundedCache } from './boundedCache'

describe('BoundedCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new BoundedCache<string, number>({ maxEntries: 2 })
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    cache.set('c', 3)

    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
  })

  it('evicts by total cost as well as entry count', () => {
    const cache = new BoundedCache<string, string>({
      maxEntries: 10,
      maxCost: 10,
      costOf: value => value.length,
    })
    cache.set('a', '12345')
    cache.set('b', '67890')
    cache.set('c', 'x')

    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('67890')
    expect(cache.get('c')).toBe('x')
    expect(cache.cost).toBe(6)
  })

  it('keeps a single oversized value until the next write', () => {
    const cache = new BoundedCache<string, string>({
      maxEntries: 4,
      maxCost: 4,
      costOf: value => value.length,
    })
    cache.set('huge', '123456789')

    expect(cache.get('huge')).toBe('123456789')
    cache.set('small', 'x')
    expect(cache.get('huge')).toBeUndefined()
    expect(cache.get('small')).toBe('x')
  })

  it('updates an existing key without double counting cost', () => {
    const cache = new BoundedCache<string, string>({
      maxEntries: 10,
      maxCost: 100,
      costOf: value => value.length,
    })
    cache.set('a', '12345')
    cache.set('a', '123')

    expect(cache.size).toBe(1)
    expect(cache.cost).toBe(3)
    expect(cache.get('a')).toBe('123')
  })

  it('supports delete and clear', () => {
    const cache = new BoundedCache<string, number>({ maxEntries: 4, maxCost: 10 })
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.delete('a')).toBe(true)
    expect(cache.delete('a')).toBe(false)
    expect(cache.cost).toBe(1)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.cost).toBe(0)
  })
})
