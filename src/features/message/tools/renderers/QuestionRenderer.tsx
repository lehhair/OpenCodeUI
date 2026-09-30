/**
 * QuestionRenderer - 提问（`question` 工具）专用渲染器
 *
 * 从 `input.questions` 拿问题结构，从 `state.metadata.answers` / `output` 解析用户答案，
 * 渲染**已回答状态**（只读）。
 *
 * ── 阶段 3b 复核结论：**这是 V2 的活代码，不要删** ────────────────────────
 *
 * 阶段 3a 报告曾把本文件归入「V1 question 体系的残留、归 3b 删除」，
 * 理由是「V2 用 Form 取代了 question」。**该前提不成立**（阶段 3b 实测）：
 *
 *   1. v2.0.19 **仍然有 `question` 工具**（`packages/core/src/tool/plugin/question.ts`，
 *      `export const name = "question"`）。它内部改调 `Form.Service.ask(...)` 弹表单，
 *      但**工具调用本身照旧落进消息历史**，形态与 V1 一致：
 *        input:    `{ questions: [{ question, header, options[{label,description}], multiple? }] }`
 *        content:  `[{ type:'text', text: 'User has answered your questions: "Q"="A". …' }]`
 *        metadata: `{ answers: [["A"]], truncated: false }`
 *      （`toModelContent()` 生成的正是上面这种 `"问题"="答案"` 文本，
 *        所以本文件的 `parseAnswersFromOutput` 依然对得上。）
 *
 *   2. **本地库实测有 54 条这样的 `question` 工具调用**，且它们所在的会话
 *      **都在 `session_v2` 表里**（即在 V2 的会话列表里可见）→ 删掉本渲染器
 *      会让这 54 条历史消息退化成「默认工具卡片」，属于功能倒退。
 *
 * 真正被 Form 取代的是**交互入口**：
 *   `InlineQuestion.tsx` / `QuestionDialog.tsx` / `InlineToolRequestContext.pendingQuestions`
 *   —— 这些已在阶段 3b 删除（表单统一由底部的 `FormDialog` 渲染与回复）。
 *
 * ⚠️ 顺带记录一条 3a 报告的事实修正（见 `InlineToolRequestContext.tsx` 顶部注释）：
 *   `Form.Info` **有** 可选的 `metadata`，`question` 工具用它把表单绑回工具调用
 *   （`metadata: { kind:'question', tool:{ messageID, id } }`）→ 将来若想做「表单内联渲染」，
 *   匹配键是 `form.metadata.tool.id === part.callID`。
 */

import { useMemo } from 'react'
import { CheckIcon } from '../../../../components/Icons'
import type { ToolRendererProps } from '../types'

// ============================================
// Types
// ============================================

interface QuestionOption {
  label: string
  description: string
}

interface QuestionInfo {
  question: string
  header?: string
  options: QuestionOption[]
  multiple?: boolean
}

interface QAPair {
  question: string
  header?: string
  options: QuestionOption[]
  multiple?: boolean
  answers: string[] // 用户选择的答案
}

// ============================================
// Main
// ============================================

export function QuestionRenderer({ part, data }: ToolRendererProps) {
  const { state } = part
  const isActive = state.status === 'running' || state.status === 'pending'
  const inputObj = state.input as Record<string, unknown> | undefined
  const output = data.output?.trim()
  const metadata = state.metadata as Record<string, unknown> | undefined

  // 从 input 拿问题结构，从 metadata/output 解析答案
  const qaList = useMemo(() => {
    return buildQAList(inputObj, output, metadata)
  }, [inputObj, output, metadata])

  // 运行中不渲染（表单由底部的 FormDialog 接管交互）
  if (isActive) {
    return null
  }

  // 用户跳过 / error 不渲染
  if (data.error || state.status === 'error') {
    return null
  }

  if (qaList.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      {qaList.map((qa, i) => (
        <AnsweredQuestion key={i} qa={qa} />
      ))}
    </div>
  )
}

// ============================================
// AnsweredQuestion — 只读的已回答问题
// ============================================

function AnsweredQuestion({ qa }: { qa: QAPair }) {
  return (
    <div className="space-y-2">
      {/* 问题文字 */}
      <div>
        {qa.header && <div className="text-[length:var(--fs-xs)] text-text-400 font-medium mb-0.5">{qa.header}</div>}
        <div className="text-[length:var(--fs-md)] text-text-100">{qa.question}</div>
      </div>

      {/* 选项 — 按钮组，已选中的高亮 */}
      <div className="flex flex-wrap gap-1.5">
        {qa.options.map((option, idx) => {
          const isSelected = qa.answers.includes(option.label)
          return (
            <span
              key={idx}
              title={option.description}
              className={`inline-flex min-h-7 items-start gap-1.5 px-2.5 py-1 text-[length:var(--fs-sm)] leading-5 rounded-md border ${
                isSelected ? 'border-text-100 text-text-100 bg-bg-300/40' : 'border-border-200/60 text-text-500'
              }`}
            >
              {qa.multiple && (
                <span className="inline-flex h-5 w-3.5 shrink-0 items-center justify-center">
                  <span
                    className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                      isSelected ? 'border-text-100 bg-text-100 text-bg-000' : 'border-border-300'
                    }`}
                  >
                    {isSelected && <CheckIcon size={10} className="shrink-0" />}
                  </span>
                </span>
              )}
              <span className="min-w-0 whitespace-normal break-words text-left">{option.label}</span>
            </span>
          )
        })}

        {/* 自定义答案（不在选项列表中的答案） */}
        {qa.answers
          .filter(a => !qa.options.some(o => o.label === a))
          .map((customAnswer, idx) => (
            <span
              key={`custom-${idx}`}
              className="inline-flex min-h-7 items-start gap-1.5 px-2.5 py-1 text-[length:var(--fs-sm)] leading-5 rounded-md border border-text-100 text-text-100 bg-bg-300/40"
            >
              {qa.multiple && (
                <span className="inline-flex h-5 w-3.5 shrink-0 items-center justify-center">
                  <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-text-100 bg-text-100 text-bg-000">
                    <CheckIcon size={10} className="shrink-0" />
                  </span>
                </span>
              )}
              <span className="min-w-0 whitespace-normal break-words text-left">{customAnswer}</span>
            </span>
          ))}
      </div>
    </div>
  )
}

// ============================================
// Parser
// ============================================

function buildQAList(
  inputObj: Record<string, unknown> | undefined,
  output: string | undefined,
  metadata: Record<string, unknown> | undefined,
): QAPair[] {
  // 从 input 获取问题结构
  const questions = extractQuestions(inputObj)

  // 优先从 metadata.answers 获取结构化答案（后端原始数组）
  const metadataAnswers = extractMetadataAnswers(metadata)

  if (metadataAnswers && questions.length > 0) {
    return questions.map((q, idx) => ({
      ...q,
      answers: metadataAnswers[idx] || [],
    }))
  }

  // fallback: 从 output 文本解析答案
  const answerMap = parseAnswersFromOutput(output)

  if (questions.length === 0 && answerMap.size === 0) {
    return []
  }

  // 有问题结构：匹配答案
  if (questions.length > 0) {
    return questions.map((q, idx) => ({
      ...q,
      answers: answerMap.get(q.question) || answerMap.get(String(idx)) || [],
    }))
  }

  // 没有问题结构，只有 output：构造简单的 QA 对
  const pairs: QAPair[] = []
  for (const [question, answers] of answerMap) {
    pairs.push({
      question,
      options: answers.map(a => ({ label: a, description: '' })),
      answers,
    })
  }
  return pairs
}

function extractQuestions(inputObj: Record<string, unknown> | undefined): QuestionInfo[] {
  if (!inputObj) return []

  // questions 数组
  const raw = inputObj.questions
  if (Array.isArray(raw)) {
    return raw.map(q => ({
      question: String(q?.question || ''),
      header: q?.header ? String(q.header) : undefined,
      options: Array.isArray(q?.options)
        ? q.options.map((o: Record<string, unknown>) => ({
            label: String(o?.label || ''),
            description: String(o?.description || ''),
          }))
        : [],
      multiple: !!q?.multiple,
    }))
  }

  return []
}

/**
 * 从 metadata.answers 提取结构化答案（后端原始 string[][] 格式）
 */
function extractMetadataAnswers(metadata: Record<string, unknown> | undefined): string[][] | undefined {
  if (!metadata?.answers || !Array.isArray(metadata.answers)) return undefined
  const answers = metadata.answers as unknown[][]
  // 验证结构：应该是 string[][] 格式
  if (answers.every(a => Array.isArray(a) && a.every(v => typeof v === 'string'))) {
    return answers as string[][]
  }
  return undefined
}

/**
 * 从 output 文本解析 "question"="answer" 对
 *
 * 后端格式：多选答案用 ", " 拼接（如 "question"="A, B"）
 * 需要拆分逗号分隔的答案
 */
function parseAnswersFromOutput(output: string | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (!output) return map

  const regex = /"([^"]*)"="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(output)) !== null) {
    const question = match[1]
    const rawAnswer = match[2]
    // 后端用 answer.join(", ") 拼接多选答案，这里拆回来
    const answers = rawAnswer
      .split(', ')
      .map(s => s.trim())
      .filter(Boolean)
    map.set(question, answers)
  }

  return map
}
