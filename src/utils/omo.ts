const OMO_INTERNAL_INITIATOR_MARKER_PATTERN = /<!--\s*OMO_INTERNAL_INITIATOR\s*-->/
const SYSTEM_REMINDER_OPEN_TAG = '<system-reminder>'
const SYSTEM_REMINDER_CLOSE_TAG = '</system-reminder>'
const SYSTEM_DIRECTIVE_PATTERN = /\[SYSTEM DIRECTIVE:[^\]]*\]/
const USER_REQUEST_OPEN_TAG = '<user-request>'
const USER_REQUEST_CLOSE_TAG = '</user-request>'
const USER_TASK_OPEN_TAG = '<user-task>'
const USER_TASK_CLOSE_TAG = '</user-task>'
const AUTO_SLASH_COMMAND_OPEN_TAG = '<auto-slash-command>'
const AUTO_SLASH_COMMAND_CLOSE_TAG = '</auto-slash-command>'
const ULTRAWORK_MODE_OPEN_TAG = '<ultrawork-mode>'
const ULTRAWORK_MODE_CLOSE_TAG = '</ultrawork-mode>'
const USER_REQUEST_HEADING = '## User Request'
const USER_ARGUMENTS_PREFIX = '**User Arguments**:'
const OMO_MODE_PROMPT_MARKERS = ['[search-mode]', '[analyze-mode]'] as const
/** 裸 ulw 前缀（非 XML 标签形式，用户直接输入 "ulw ..."） */
const BARE_ULW_PATTERN = /^ulw\b\s*/

interface TaggedContent {
  content: string
  closeIndex: number
}

export type OmoModePromptMarker = (typeof OMO_MODE_PROMPT_MARKERS)[number]

export function hasOmoInternalInitiatorMarker(rawText: string): boolean {
  return OMO_INTERNAL_INITIATOR_MARKER_PATTERN.test(rawText.normalize('NFC'))
}

/** 检测结果类型 */
export interface OmoWrapperResult {
  /** 是否被 OMO 包装 */
  isWrapped: boolean
  /** 分类标签列表，如 ['ulw', 'search-mode'] */
  labels: string[]
  /** 提取出的真实用户 prompt */
  userText: string | undefined
  /** 原始包装内容（用于展开查看） */
  rawWrapper: string | undefined
}

/**
 * 统一检测 OMO 包装消息——支持多标签。
 * 收集所有匹配的 system 级别标记，然后提取真实用户文本。
 */
export function detectOmoWrapper(rawText: string): OmoWrapperResult {
  const source = rawText.normalize('NFC').trimStart()
  if (!source) return { isWrapped: false, labels: [], userText: undefined, rawWrapper: undefined }

  const labels: string[] = []
  let userText: string | undefined
  let rawWrapper: string | undefined

  // ── Phase 1: 收集所有 user-oriented 标记 ──
  // 扫描所有 mode markers（一个消息可能同时有 [search-mode] 和 [analyze-mode]）
  for (const marker of OMO_MODE_PROMPT_MARKERS) {
    if (source.includes(marker)) {
      const label = marker.replace(/\[|\]/g, '')
      if (!labels.includes(label)) labels.push(label)
    }
  }

  // 预先提取 mode marker 后的 body，用于在其中继续扫描额外标记
  // 先剥离可能的 OMO comment 前缀
  let modeBody = hasOmoInternalInitiatorMarker(source)
    ? source.replace(OMO_INTERNAL_INITIATOR_MARKER_PATTERN, '').trimStart()
    : source
  const firstMarker = findOmoModePromptMarker(modeBody)
  if (firstMarker) {
    const body = extractOmoModePromptBody(modeBody)
    if (body) modeBody = body
  }

  // 在 body 中查找 ulw
  if (BARE_ULW_PATTERN.test(modeBody) && !labels.includes('ulw')) {
    labels.push('ulw')
  }

  // 在 body 中检查 ultrawork-mode XML（可能在 body 开头或内部）
  if ((modeBody.startsWith(ULTRAWORK_MODE_OPEN_TAG) || source.includes(ULTRAWORK_MODE_OPEN_TAG)) && !labels.includes('ulw')) {
    labels.push('ulw')
  }

  // ── Phase 2: userText 提取（按优先级应用 stripper） ──
  if (labels.length > 0) {
    let working = source

    // 2a. 剥离 OMO comment 前缀（如果存在），否则后续 stripper 找不到位于其后的 marker
    if (hasOmoInternalInitiatorMarker(working)) {
      working = working.replace(OMO_INTERNAL_INITIATOR_MARKER_PATTERN, '').trimStart()
    }

    // 2b. 剥离 mode marker 前缀（根据 labels 判断，而非 firstMarker）
    const hasModeLabel = labels.some(l => l === 'search-mode' || l === 'analyze-mode')
    if (hasModeLabel) {
      const body = extractOmoModePromptBody(working)
      working = body ?? working
    }

    // 2c. 剥离裸 ulw
    const ulwMatch = working.match(BARE_ULW_PATTERN)
    if (ulwMatch) {
      working = working.slice(ulwMatch[0].length).trim()
    }

    // 2d. 剥离 ultrawork-mode XML
    const uwTrailing = extractOmoUltraworkTrailingUserText(working)
    if (uwTrailing !== undefined) {
      working = uwTrailing
    }

    // 2e. 兜底正则剥离：移除已知的 [search-mode] / [analyze-mode] / <ultrawork-mode> 文本块
    //     作为保底，即使前面的逻辑未完全清理也能生效
    working = stripKnownOmoBlocks(working)

    userText = working || undefined
    rawWrapper = source
  }

  // ── Phase 3: 仅无 user label 时检查 system-only 包装 ──
  if (labels.length === 0) {
    // system-reminder
    const sr = extractLastTaggedContent(source, SYSTEM_REMINDER_OPEN_TAG, SYSTEM_REMINDER_CLOSE_TAG)
    if (sr) {
      labels.push('system-reminder')
      let trailing = source.slice(sr.closeIndex + SYSTEM_REMINDER_CLOSE_TAG.length).trim()
      // 剥离尾部可能跟随的 OMO_INTERNAL_INITIATOR 标记
      trailing = trailing.replace(OMO_INTERNAL_INITIATOR_MARKER_PATTERN, '').trim()
      userText = trailing || undefined
      rawWrapper = sr.content
    }
  }

  // OMO_INTERNAL_INITIATOR（提到 SYSTEM DIRECTIVE 之前，更好地处理纯系统消息）
  if (labels.length === 0) {
    if (hasOmoInternalInitiatorMarker(source)) {
      labels.push('omo')
      // 先尝试提取包装的用户文本
      const wrapped = extractOmoWrappedUserText(source)
      if (wrapped) {
        userText = wrapped
        rawWrapper = source
      } else {
        // 剥离 OMO 标记后保留剩余文本（用户可能引用提及 OMO 标记本身）
        const stripped = source.replace(OMO_INTERNAL_INITIATOR_MARKER_PATTERN, '').trimStart()
        const innerUlw = stripped.match(BARE_ULW_PATTERN)
        if (innerUlw) {
          userText = stripped.slice(innerUlw[0].length).trim() || undefined
        } else if (stripped) {
          userText = stripped
        }
        // stripped 为空 → userText 保持 undefined（纯标记消息）
        rawWrapper = source
      }
    }
  }

  if (labels.length === 0) {
    const dm = source.match(SYSTEM_DIRECTIVE_PATTERN)
    if (dm) {
      labels.push('system-directive')
      userText = source.slice(dm.index! + dm[0].length).trim() || undefined
      rawWrapper = dm[0]
    }
  }

  if (labels.length === 0) {
    const wrappedUserText = extractOmoWrappedUserText(source)
    if (wrappedUserText) {
      labels.push('omo')
      userText = wrappedUserText
      rawWrapper = source
    }
  }

  // ── 最终兜底：对 userText 做正则清理（覆盖 Phase 2 和 Phase 3 的所有结果） ──
  if (userText) {
    userText = stripKnownOmoBlocks(userText) || undefined
  }

  return { isWrapped: labels.length > 0, labels, userText, rawWrapper }
}

/** 判断是否是被 OMO 包装的消息（用于过滤） */
export function isOmoWrappedMessage(rawText: string): boolean {
  return detectOmoWrapper(rawText).isWrapped
}

/** 提取 OMO 包装后的真实用户文本（用于显示） */
export function extractOmoUserText(rawText: string): string | undefined {
  return detectOmoWrapper(rawText).userText
}

/** 提取 OMO 标签列表（用于显示标签） */
export function extractOmoLabels(rawText: string): string[] {
  return detectOmoWrapper(rawText).labels
}

export function extractOmoLastUserRequest(rawText: string): string | undefined {
  return extractLastTaggedContent(rawText.normalize('NFC'), USER_REQUEST_OPEN_TAG, USER_REQUEST_CLOSE_TAG)?.content
}

export function extractOmoLastUserTask(rawText: string): string | undefined {
  return extractLastTaggedContent(rawText.normalize('NFC'), USER_TASK_OPEN_TAG, USER_TASK_CLOSE_TAG)?.content
}

export function extractOmoWrappedUserText(rawText: string): string | undefined {
  const source = rawText.normalize('NFC')
  const userRequest = extractLastTaggedContent(source, USER_REQUEST_OPEN_TAG, USER_REQUEST_CLOSE_TAG)
  const userTask = extractLastTaggedContent(source, USER_TASK_OPEN_TAG, USER_TASK_CLOSE_TAG)
  const taggedUserText = [userRequest, userTask]
    .filter((content): content is TaggedContent => content !== undefined)
    .sort((a, b) => b.closeIndex - a.closeIndex)[0]
  if (taggedUserText) return taggedUserText.content

  const autoSlashCommand = extractLastTaggedContent(source, AUTO_SLASH_COMMAND_OPEN_TAG, AUTO_SLASH_COMMAND_CLOSE_TAG)
  if (!autoSlashCommand) return undefined
  return extractMarkdownUserRequest(autoSlashCommand.content) ?? extractUserArguments(autoSlashCommand.content)
}

export function findOmoModePromptMarker(rawText: string): OmoModePromptMarker | undefined {
  const trimmedStart = rawText.normalize('NFC').trimStart()
  return OMO_MODE_PROMPT_MARKERS.find(marker => trimmedStart.startsWith(marker))
}

export function extractOmoModePromptBody(rawText: string): string | undefined {
  const source = rawText.normalize('NFC')
  const trimmedStart = source.trimStart()
  const marker = findOmoModePromptMarker(trimmedStart)
  if (!marker) return undefined

  const wrappedUserText = extractOmoWrappedUserText(trimmedStart)
  if (wrappedUserText) return wrappedUserText

  const lines = trimmedStart.split(/\r?\n/)
  let separatorIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') separatorIndex = i
  }

  const body = separatorIndex >= 0 ? lines.slice(separatorIndex + 1).join('\n') : trimmedStart.slice(marker.length)
  const cleaned = body.trim()
  return cleaned || undefined
}

export function extractOmoUltraworkTrailingUserText(rawText: string): string | undefined {
  const trimmedStart = rawText.normalize('NFC').trimStart()
  if (!trimmedStart.startsWith(ULTRAWORK_MODE_OPEN_TAG)) return undefined

  const closeIndex = trimmedStart.indexOf(ULTRAWORK_MODE_CLOSE_TAG)
  if (closeIndex === -1) return undefined

  const trailing = trimmedStart.slice(closeIndex + ULTRAWORK_MODE_CLOSE_TAG.length).trim()
  if (!trailing) return undefined

  const cleaned = trailing.replace(/^(?:---\s*(?:\r?\n|$))+/, '').trim()
  return cleaned || undefined
}

/** 兜底正则剥离：移除 [search-mode] / [analyze-mode] / <ultrawork-mode> 的已知固定提示词文本块 */
function stripKnownOmoBlocks(rawText: string): string {
  let text = rawText

  // [search-mode] 文本块：从 [search-mode]\n 到下一个 [xxx] / <xxx> / --- / OMO 标记 / 字符串末尾
  text = text.replace(
    /\[search-mode\]\s*\n[\s\S]*?(?=\[analyze-mode\]|\[search-mode\]|<ultrawork|<system-reminder>|---\s*\n|<!-- OMO|$)/g,
    '',
  )

  // [analyze-mode] 文本块：同上
  text = text.replace(
    /\[analyze-mode\]\s*\n[\s\S]*?(?=\[search-mode\]|\[analyze-mode\]|<ultrawork|<system-reminder>|---\s*\n|<!-- OMO|$)/g,
    '',
  )

  // <ultrawork-mode>...</ultrawork-mode> 文本块
  text = text.replace(/<ultrawork-mode>[\s\S]*?<\/ultrawork-mode>/g, '')

  // OMO delegate_task 标准指令行（出现在 --- 分隔之后，逐行剥离）
  text = text.replace(/^MANDATORY delegate_task[^\n]*\n?/gm, '')
  text = text.replace(/^Example: delegate_task[^\n]*\n?/gm, '')

  // 清理残留的 --- 分隔线
  text = text.replace(/^---\s*\n/gm, '')

  return text.trim()
}

function extractLastTaggedContent(rawText: string, openTag: string, closeTag: string): TaggedContent | undefined {
  let closeIndex = rawText.lastIndexOf(closeTag)

  while (closeIndex !== -1) {
    const openIndex = rawText.lastIndexOf(openTag, closeIndex)
    if (openIndex === -1) return undefined

    const contentStart = openIndex + openTag.length
    const content = rawText.slice(contentStart, closeIndex).trim()
    if (content) return { content, closeIndex }

    closeIndex = rawText.lastIndexOf(closeTag, openIndex - 1)
  }

  return undefined
}

function extractMarkdownUserRequest(rawText: string): string | undefined {
  const lines = rawText.normalize('NFC').split(/\r?\n/)
  let headingIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === USER_REQUEST_HEADING) headingIndex = i
  }
  if (headingIndex === -1) return undefined

  const content = lines.slice(headingIndex + 1).join('\n').trim()
  return content || undefined
}

function extractUserArguments(rawText: string): string | undefined {
  const lines = rawText.normalize('NFC').split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith(USER_ARGUMENTS_PREFIX)) continue
    const content = line.slice(USER_ARGUMENTS_PREFIX.length).trim()
    return content || undefined
  }
  return undefined
}
