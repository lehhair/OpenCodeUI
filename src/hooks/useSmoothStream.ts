import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Smooth Streaming Hook
 * 
 * 核心原则：
 * 1. 只有在 streaming 状态下的**新增内容**才需要打字机效果
 * 2. 历史消息、已加载的内容直接显示，不做动画
 * 3. streaming 结束时立即显示剩余全部内容
 * 
 * 参考：Upstash blog, Sam Selikoff's useAnimatedText
 */

interface UseSmoothStreamOptions {
  /** 每个字符的显示间隔（毫秒），默认 8ms ≈ 125 字符/秒 */
  charDelay?: number
}

interface UseSmoothStreamResult {
  /** 当前应该显示的文本 */
  displayText: string
  /** 是否正在播放动画 */
  isAnimating: boolean
  /** 强制立即显示全部内容 */
  flush: () => void
}

export function useSmoothStream(
  /** 完整的目标文本（会持续更新） */
  fullText: string,
  /** 是否正在 streaming */
  isStreaming: boolean,
  options: UseSmoothStreamOptions = {}
): UseSmoothStreamResult {
  const { charDelay = 8 } = options

  // 当前显示的字符索引
  const [displayIndex, setDisplayIndex] = useState(() => {
    // 关键：初始化时如果不是 streaming，直接显示全部
    return isStreaming ? 0 : fullText.length
  })
  
  // Refs for animation control
  const frameRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number>(0)
  
  // 追踪 streaming 状态变化
  const wasStreamingRef = useRef(isStreaming)
  // 追踪上一次的文本内容，用于检测内容重置
  const prevTextRef = useRef(fullText)

  // 检测内容重置（新对话/切换 session）
  useEffect(() => {
    const prevText = prevTextRef.current
    
    // 如果文本完全不同（不是追加），说明是新内容
    // 判断标准：新文本不是以旧文本开头，且长度差异大
    const isNewContent = fullText.length > 0 && 
                         prevText.length > 0 && 
                         !fullText.startsWith(prevText.slice(0, Math.min(prevText.length, 20)))
    
    if (isNewContent) {
      // 新内容，如果是 streaming 就从头开始动画，否则直接显示全部
      setDisplayIndex(isStreaming ? 0 : fullText.length)
    }
    
    prevTextRef.current = fullText
  }, [fullText, isStreaming])

  // 核心：处理 streaming 状态变化
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current
    
    // streaming 刚开始：如果之前没有 streaming 且现在开始了
    if (!wasStreaming && isStreaming) {
      // 新的 stream 开始，从当前位置开始动画（可能是 0，也可能是已有内容的末尾）
      // 不重置 displayIndex，这样可以支持"继续生成"的场景
    }
    
    // streaming 刚结束：立即显示全部剩余内容
    if (wasStreaming && !isStreaming) {
      setDisplayIndex(fullText.length)
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
    
    wasStreamingRef.current = isStreaming
  }, [isStreaming, fullText.length])

  // 动画逻辑：只在 streaming 且还有内容未显示时运行
  useEffect(() => {
    // 不是 streaming，不需要动画
    if (!isStreaming) {
      return
    }

    // 已经显示完了
    if (displayIndex >= fullText.length) {
      return
    }

    const animate = (time: number) => {
      const elapsed = time - lastTimeRef.current
      
      if (elapsed >= charDelay) {
        const charsToAdd = Math.max(1, Math.floor(elapsed / charDelay))
        
        setDisplayIndex(prev => {
          const next = Math.min(prev + charsToAdd, fullText.length)
          return next
        })
        
        lastTimeRef.current = time
      }

      frameRef.current = requestAnimationFrame(animate)
    }

    // 初始化时间
    if (lastTimeRef.current === 0) {
      lastTimeRef.current = performance.now()
    }

    frameRef.current = requestAnimationFrame(animate)

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [fullText.length, displayIndex, isStreaming, charDelay])

  // 强制立即显示全部
  const flush = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    setDisplayIndex(fullText.length)
  }, [fullText.length])

  // 计算当前应该显示的文本
  // 非 streaming 时直接显示全部，streaming 时显示到 displayIndex
  const displayText = isStreaming ? fullText.slice(0, displayIndex) : fullText
  const isAnimating = isStreaming && displayIndex < fullText.length

  return {
    displayText,
    isAnimating,
    flush,
  }
}
