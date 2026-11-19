/**
 * 有上限的 LRU 缓存。
 *
 * 消息渲染链路上有多个“内容相关”的缓存（Markdown HTML、分块结果、Mermaid SVG、
 * 高亮 token、折叠状态）。它们都需要同样的行为：
 * - 命中即刷新为最近使用
 * - 同时受条数和估算成本约束
 * - 单个超大值不能把刚写入的条目立刻挤掉
 *
 * 以前每个文件各写一份手写淘汰循环，口径容易漂移。统一在这里实现。
 */
export interface BoundedCacheOptions<T> {
  /** 最大条数 */
  maxEntries: number
  /** 最大总成本；不传表示只按条数限制 */
  maxCost?: number
  /** 单个值的成本估算，默认 1 */
  costOf?: (value: T) => number
}

interface CacheEntry<T> {
  value: T
  cost: number
}

export class BoundedCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>()
  private readonly maxEntries: number
  private readonly maxCost: number
  private readonly costOf: (value: V) => number
  private totalCost = 0

  constructor(options: BoundedCacheOptions<V>) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries))
    this.maxCost = options.maxCost != null && Number.isFinite(options.maxCost) ? options.maxCost : Number.POSITIVE_INFINITY
    this.costOf = options.costOf ?? (() => 1)
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    // Map 的插入顺序即 LRU：命中后移到队尾
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: K, value: V): void {
    const cost = this.costOf(value)
    const existing = this.entries.get(key)
    if (existing) {
      this.totalCost -= existing.cost
      this.entries.delete(key)
    }
    this.entries.set(key, { value, cost })
    this.totalCost += cost
    this.trim(key)
  }

  delete(key: K): boolean {
    const entry = this.entries.get(key)
    if (!entry) return false
    this.totalCost -= entry.cost
    return this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
    this.totalCost = 0
  }

  get size(): number {
    return this.entries.size
  }

  /** 当前累计成本，测试与调试用 */
  get cost(): number {
    return this.totalCost
  }

  private trim(protectedKey: K): void {
    while (this.entries.size > this.maxEntries || this.totalCost > this.maxCost) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      // 只写了一个超大值时不立刻自我淘汰：下一次写入会把它挤出去
      if (this.entries.size === 1 && oldest === protectedKey) break
      const entry = this.entries.get(oldest)
      this.entries.delete(oldest)
      if (entry) this.totalCost -= entry.cost
    }
  }
}
