import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from '../Icons'

interface DialogProps {
  isOpen: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  width?: string | number
  className?: string
  showCloseButton?: boolean
}

export function Dialog({
  isOpen,
  onClose,
  title,
  children,
  width = 400,
  className = '',
  showCloseButton = true,
}: DialogProps) {
  // Animation state
  const [shouldRender, setShouldRender] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  // Mount/Unmount logic
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
    } else {
      setIsVisible(false)
      const timer = setTimeout(() => setShouldRender(false), 200)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Visibility logic
  useEffect(() => {
    if (shouldRender && isOpen) {
      // Small delay to ensure DOM is ready and transition triggers
      const timer = setTimeout(() => setIsVisible(true), 10)
      return () => clearTimeout(timer)
    }
  }, [shouldRender, isOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!shouldRender) return null

  return createPortal(
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-0 transition-all duration-200 ease-out"
      style={{
        backgroundColor: isVisible ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0)',
        backdropFilter: isVisible ? 'blur(2px)' : 'blur(0px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Dialog Panel */}
      <div 
        className={`
          relative bg-bg-000 border border-border-200 rounded-xl shadow-2xl 
          flex flex-col overflow-hidden transition-all duration-200 ease-out
          ${className}
        `}
        style={{ 
          width: typeof width === 'number' ? `${width}px` : width, 
          maxWidth: '100%',
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(8px)',
        }}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-100/50">
            <div className="text-lg font-semibold text-text-100">{title}</div>
            {showCloseButton && (
              <button 
                onClick={onClose}
                className="p-1 text-text-400 hover:text-text-200 hover:bg-bg-100 rounded-md transition-colors"
              >
                <CloseIcon size={18} />
              </button>
            )}
          </div>
        )}
        
        {/* Content */}
        <div className="p-5 overflow-y-auto custom-scrollbar max-h-[80vh]">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
