import { useState, useEffect, useRef } from 'react'

export function useInView(options: IntersectionObserverInit & { triggerOnce?: boolean } = {}) {
  const [inView, setInView] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { root = null, rootMargin, threshold, triggerOnce } = options

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          if (triggerOnce) {
            observer.unobserve(element)
          }
        } else {
          if (!triggerOnce) {
            setInView(false)
          }
        }
      },
      { root, rootMargin, threshold },
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [root, rootMargin, threshold, triggerOnce])

  return { ref, inView }
}
