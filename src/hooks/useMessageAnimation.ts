import { useCallback, useRef, useEffect } from 'react'

interface AnimationRefs {
  messageRefs: Map<string, HTMLElement>
  inputBoxRef: HTMLElement | null
}

export function useMessageAnimation() {
  const refs = useRef<AnimationRefs>({
    messageRefs: new Map(),
    inputBoxRef: null
  })
  
  // 追踪所有 timeout，用于清理
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  
  // 清理所有 timeout
  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(id => clearTimeout(id))
      timeoutsRef.current.clear()
    }
  }, [])
  
  // 包装 setTimeout，自动追踪和清理
  const safeTimeout = useCallback((fn: () => void, delay: number) => {
    const id = setTimeout(() => {
      timeoutsRef.current.delete(id)
      fn()
    }, delay)
    timeoutsRef.current.add(id)
    return id
  }, [])

  // 注册消息元素（所有消息都注册，不只是用户消息）
  const registerMessage = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      refs.current.messageRefs.set(id, element)
    } else {
      refs.current.messageRefs.delete(id)
    }
  }, [])

  // 注册输入框元素
  const registerInputBox = useCallback((element: HTMLElement | null) => {
    refs.current.inputBoxRef = element
  }, [])

  // 撤销动画：消息淡出 + 输入框脉冲
  // messageIds: 要撤销的所有消息 ID（包括用户消息和助手消息）
  const animateUndo = useCallback((messageIds: string[]): Promise<void> => {
    return new Promise((resolve) => {
      const inputBoxEl = refs.current.inputBoxRef
      
      // 给每个消息添加消失动画，带有交错延迟
      messageIds.forEach((id, index) => {
        const el = refs.current.messageRefs.get(id)
        if (el) {
          const delay = index * 30 // 交错延迟
          el.style.transition = `all 220ms cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms`
          el.style.opacity = '0'
          el.style.transform = 'translateY(8px) scale(0.98)'
        }
      })
      
      // 输入框脉冲效果
      if (inputBoxEl) {
        safeTimeout(() => {
          inputBoxEl.style.transition = 'box-shadow 150ms ease-out, transform 150ms cubic-bezier(0.34, 1.2, 0.64, 1)'
          inputBoxEl.style.boxShadow = '0 0 0 2px hsl(var(--accent-main-100) / 0.3), 0 0.25rem 1.25rem rgba(0,0,0,0.1)'
          inputBoxEl.style.transform = 'scale(1.005)'
          
          safeTimeout(() => {
            inputBoxEl.style.boxShadow = ''
            inputBoxEl.style.transform = ''
          }, 200)
        }, 100)
      }

      // 等待所有动画完成
      const totalDuration = 220 + (messageIds.length - 1) * 30 + 50
      safeTimeout(resolve, Math.min(totalDuration, 350))
    })
  }, [safeTimeout])

  // 恢复动画：输入框收缩 + 消息准备进入
  const animateRedo = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const inputBoxEl = refs.current.inputBoxRef

      if (inputBoxEl) {
        inputBoxEl.style.transition = 'transform 180ms cubic-bezier(0.34, 1.2, 0.64, 1), box-shadow 180ms ease-out'
        inputBoxEl.style.transform = 'scale(0.995)'
        inputBoxEl.style.boxShadow = '0 0 0 1px hsl(var(--accent-main-100) / 0.2)'
        
        safeTimeout(() => {
          inputBoxEl.style.transform = ''
          inputBoxEl.style.boxShadow = ''
        }, 180)
      }

      safeTimeout(resolve, 80)
    })
  }, [safeTimeout])

  return {
    registerMessage,
    registerInputBox,
    animateUndo,
    animateRedo
  }
}
