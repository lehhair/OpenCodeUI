// ============================================
// UsageExceededDialog — 用量超限对话框
//
// 对齐官方 packages/app/src/providers/connect/usage-exceeded.tsx：
// 标题 + 描述 + 「不再提示」(ghost) + 主按钮（打开链接）。
// 关闭且未选「不再提示」时，按官方行为引导连接 opencode-go
// （打开 ProviderConnectDialog）。
// ============================================

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Button } from './ui'
import { useUsageExceededRequest, usageExceededStore } from '../store/usageExceededStore'
import { openExternalUrl } from '../utils/externalUrl'
import { ProviderConnectDialog } from '../features/settings/components/ProviderConnectDialog'

export function UsageExceededDialog() {
  const { t, i18n } = useTranslation(['chat', 'common'])
  const request = useUsageExceededRequest()
  const [connectOpen, setConnectOpen] = useState(false)

  const isEnglish = i18n.language.startsWith('en')
  // 官方同款：英文直接用服务端 action 文案，其它语言用本地翻译
  const title = request
    ? isEnglish
      ? request.title
      : t(`chat:usageExceeded.${request.reason === 'free_tier_limit' ? 'freeTier' : 'accountRateLimit'}.title`)
    : ''
  const description = request
    ? isEnglish
      ? request.message
      : t(`chat:usageExceeded.${request.reason === 'free_tier_limit' ? 'freeTier' : 'accountRateLimit'}.description`)
    : ''
  const actionLabel = request
    ? isEnglish
      ? request.label
      : t(`chat:usageExceeded.${request.reason === 'free_tier_limit' ? 'freeTier' : 'accountRateLimit'}.actionLabel`)
    : ''

  const close = (dontShowAgain: boolean) => {
    const shouldGuide = usageExceededStore.dismiss(dontShowAgain)
    // 官方同款：用户没有选「不再提示」→ 引导连接 opencode-go
    if (shouldGuide) setConnectOpen(true)
  }

  return (
    <>
      <Dialog isOpen={request !== null} onClose={() => close(false)} title={title} width={440}>
        <div className="flex flex-col gap-4 pb-1">
          <p className="text-[length:var(--fs-base)] text-text-300 leading-relaxed">{description}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => close(true)}>
              {t('chat:usageExceeded.dontShowAgain')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (request?.link) void openExternalUrl(request.link)
                close(false)
              }}
            >
              {actionLabel}
            </Button>
          </div>
        </div>
      </Dialog>

      <ProviderConnectDialog isOpen={connectOpen} onClose={() => setConnectOpen(false)} initialProvider="opencode-go" />
    </>
  )
}
