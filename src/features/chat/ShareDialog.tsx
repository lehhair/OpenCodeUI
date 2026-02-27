import { useState, useEffect } from 'react'
import { Dialog, Button, IconButton } from '../../components/ui'
import { LinkIcon, CopyIcon, GlobeIcon, SpinnerIcon, CheckIcon } from '../../components/Icons'
import { shareSession, unshareSession } from '../../api'
import { useMessageStore, messageStore } from '../../store'
import { apiErrorHandler } from '../../utils'

interface ShareDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function ShareDialog({ isOpen, onClose }: ShareDialogProps) {
  const { sessionId, shareUrl, sessionDirectory } = useMessageStore()
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setCopied(false)
      setError(null)
    }
  }, [isOpen])

  const handleShare = async () => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      const updatedSession = await shareSession(sessionId, sessionDirectory)
      messageStore.setShareUrl(sessionId, updatedSession.share?.url)
    } catch (e) {
      setError('Failed to create share link')
      apiErrorHandler('share session', e)
    } finally {
      setLoading(false)
    }
  }

  const handleUnshare = async () => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      await unshareSession(sessionId, sessionDirectory)
      messageStore.setShareUrl(sessionId, undefined)
    } catch (e) {
      setError('Failed to remove share link')
      apiErrorHandler('unshare session', e)
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!sessionId) return null

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Share Chat"
      className="w-full max-w-md"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 p-3 bg-bg-200/30 rounded-lg border border-border-200">
          <div className="p-2 bg-bg-200 rounded-full text-text-400">
            <GlobeIcon size={20} />
          </div>
          <div>
            <h3 className="font-medium text-text-100">Public Link</h3>
            <p className="text-sm text-text-400 mt-1">
              Anyone with this link can view this chat session.
            </p>
          </div>
        </div>

        {error && (
          <div className="text-danger-100 text-sm px-1">{error}</div>
        )}

        {shareUrl ? (
          <div className="flex flex-col gap-3">
             <div className="flex items-center gap-2 p-2 bg-bg-100 border border-border-300 rounded-md">
                <div className="flex-1 truncate text-sm font-mono text-text-200 select-all">
                  {shareUrl}
                </div>
                <IconButton
                  onClick={handleCopy}
                  title="Copy link"
                  aria-label="Copy link"
                  className={copied ? "text-success-100" : "text-text-400 hover:text-text-100"}
                >
                  {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                </IconButton>
             </div>
             
             <div className="flex justify-between items-center mt-2">
               <Button
                  variant="ghost" 
                  className="text-danger-100 hover:text-danger-200 hover:bg-danger-bg px-0"
                  onClick={handleUnshare}
                  disabled={loading}
               >
                 {loading ? "Processing..." : "Stop sharing"}
               </Button>
               <Button onClick={onClose}>Done</Button>
             </div>
          </div>
        ) : (
          <div className="flex justify-end mt-2">
            <Button 
              onClick={handleShare} 
              disabled={loading}
              className="w-full sm:w-auto"
            >
              {loading ? (
                <>
                  <SpinnerIcon className="animate-spin mr-2" />
                  Creating link...
                </>
              ) : (
                <>
                  <LinkIcon className="mr-2" size={16} />
                  Create public link
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
