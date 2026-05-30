const OMO_INTERNAL_INITIATOR_MARKER_PATTERN = /<!--\s*OMO_INTERNAL_INITIATOR\s*-->/
const USER_REQUEST_OPEN_TAG = '<user-request>'
const USER_REQUEST_CLOSE_TAG = '</user-request>'
const USER_TASK_OPEN_TAG = '<user-task>'
const USER_TASK_CLOSE_TAG = '</user-task>'
const AUTO_SLASH_COMMAND_OPEN_TAG = '<auto-slash-command>'
const AUTO_SLASH_COMMAND_CLOSE_TAG = '</auto-slash-command>'
const USER_REQUEST_HEADING = '## User Request'
const USER_ARGUMENTS_PREFIX = '**User Arguments**:'
const MODE_PROMPT_MARKERS = ['[search-mode]', '[analyze-mode]']

interface TaggedContent {
  content: string
  closeIndex: number
}

export function outlineIndexHasOmoInternalInitiatorMarker(rawText: string): boolean {
  return OMO_INTERNAL_INITIATOR_MARKER_PATTERN.test(rawText.normalize('NFC'))
}

export function outlineIndexIsOmoInternalReminder(rawText: string): boolean {
  const source = rawText.normalize('NFC').trim()
  return source.startsWith('<system-reminder>') && source.endsWith('<!-- OMO_INTERNAL_INITIATOR -->')
}

export function outlineIndexSimplifySearchModePrompt(rawText: string): string | undefined {
  return outlineIndexSimplifyModePrompt(rawText)
}

export function outlineIndexSimplifyModePrompt(rawText: string): string | undefined {
  const source = rawText.normalize('NFC')
  const trimmedStart = source.trimStart()
  if (!outlineIndexStartsWithModePrompt(trimmedStart)) return undefined

  const wrappedUserText = outlineIndexExtractWrappedUserText(trimmedStart)
  if (wrappedUserText) return wrappedUserText

  const lines = trimmedStart.split(/\r?\n/)
  let separatorIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') separatorIndex = i
  }

  const marker = outlineIndexFindModePromptMarker(trimmedStart)
  const body = separatorIndex >= 0 ? lines.slice(separatorIndex + 1).join('\n') : trimmedStart.slice(marker.length)
  const cleaned = body.trim()
  return cleaned || undefined
}

export function outlineIndexExtractLastUserRequest(rawText: string): string | undefined {
  return outlineIndexExtractLastTaggedContent(rawText, USER_REQUEST_OPEN_TAG, USER_REQUEST_CLOSE_TAG)?.content
}

export function outlineIndexExtractLastUserTask(rawText: string): string | undefined {
  return outlineIndexExtractLastTaggedContent(rawText, USER_TASK_OPEN_TAG, USER_TASK_CLOSE_TAG)?.content
}

function outlineIndexExtractWrappedUserText(rawText: string): string | undefined {
  const userRequest = outlineIndexExtractLastTaggedContent(rawText, USER_REQUEST_OPEN_TAG, USER_REQUEST_CLOSE_TAG)
  const userTask = outlineIndexExtractLastTaggedContent(rawText, USER_TASK_OPEN_TAG, USER_TASK_CLOSE_TAG)
  const taggedUserText = [userRequest, userTask]
    .filter((content): content is TaggedContent => content !== undefined)
    .sort((a, b) => b.closeIndex - a.closeIndex)[0]
  if (taggedUserText) return taggedUserText.content

  const autoSlashCommand = outlineIndexExtractLastTaggedContent(
    rawText,
    AUTO_SLASH_COMMAND_OPEN_TAG,
    AUTO_SLASH_COMMAND_CLOSE_TAG,
  )
  if (!autoSlashCommand) return undefined
  return outlineIndexExtractMarkdownUserRequest(autoSlashCommand.content) ?? outlineIndexExtractUserArguments(autoSlashCommand.content)
}

function outlineIndexExtractLastTaggedContent(rawText: string, openTag: string, closeTag: string): TaggedContent | undefined {
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

function outlineIndexExtractMarkdownUserRequest(rawText: string): string | undefined {
  const lines = rawText.normalize('NFC').split(/\r?\n/)
  let headingIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === USER_REQUEST_HEADING) headingIndex = i
  }
  if (headingIndex === -1) return undefined

  const content = lines.slice(headingIndex + 1).join('\n').trim()
  return content || undefined
}

function outlineIndexExtractUserArguments(rawText: string): string | undefined {
  const lines = rawText.normalize('NFC').split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith(USER_ARGUMENTS_PREFIX)) continue
    const content = line.slice(USER_ARGUMENTS_PREFIX.length).trim()
    return content || undefined
  }
  return undefined
}

function outlineIndexStartsWithModePrompt(rawText: string): boolean {
  return outlineIndexFindModePromptMarker(rawText).length > 0
}

function outlineIndexFindModePromptMarker(rawText: string): string {
  return MODE_PROMPT_MARKERS.find(marker => rawText.startsWith(marker)) ?? ''
}

export function outlineIndexCleanupOmoTitle(rawText: string): string | undefined {
  if (outlineIndexHasOmoInternalInitiatorMarker(rawText)) return undefined
  const source = rawText.normalize('NFC')
  const wrappedUserText = outlineIndexExtractWrappedUserText(source)
  if (wrappedUserText) return wrappedUserText
  if (!outlineIndexStartsWithModePrompt(source.trimStart())) return rawText
  return outlineIndexSimplifyModePrompt(rawText)
}
