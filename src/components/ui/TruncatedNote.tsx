import { useTranslation } from 'react-i18next'
import { formatContentSize } from '../../utils/contentBudget'

interface TruncatedNoteProps {
  omittedLines: number
  omittedChars: number
  className?: string
}

/**
 * 内联内容被裁剪后的提示。
 *
 * 行数为 0 说明是单行超长文本（压缩过的 JSON 之类），只报体积，别写成「已省略 0 行」。
 */
export function TruncatedNote({ omittedLines, omittedChars, className = '' }: TruncatedNoteProps) {
  const { t } = useTranslation('components')
  const size = formatContentSize(omittedChars)
  return (
    <div className={className}>
      {omittedLines > 0
        ? t('contentBlock.truncated', { lines: omittedLines, size })
        : t('contentBlock.truncatedBytes', { size })}
    </div>
  )
}
