/**
 * QuestionRenderer - 提问工具专用渲染器
 *
 * 从 input 获取问题结构，从 output 解析用户答案，
 * 用和 InlineQuestion 一致的视觉风格渲染已回答状态（只读）。
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

  // 运行中不渲染（InlineQuestion 接管交互）
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
        {qa.header && <div className="text-[11px] text-text-400 font-medium mb-0.5">{qa.header}</div>}
        <div className="text-[13px] text-text-100">{qa.question}</div>
      </div>

      {/* 选项 — 和 InlineQuestion 一致的按钮组，已选中的高亮 */}
      <div className="flex flex-wrap gap-1.5">
        {qa.options.map((option, idx) => {
          const isSelected = qa.answers.includes(option.label)
          return (
            <span
              key={idx}
              title={option.description}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-md border ${
                isSelected ? 'border-text-100 text-text-100 bg-bg-300/40' : 'border-border-200/60 text-text-500'
              }`}
            >
              {qa.multiple && (
                <span
                  className={`inline-flex w-3.5 h-3.5 rounded items-center justify-center border ${
                    isSelected ? 'border-text-100 bg-text-100 text-bg-000' : 'border-border-300'
                  }`}
                >
                  {isSelected && <CheckIcon size={10} />}
                </span>
              )}
              {option.label}
            </span>
          )
        })}

        {/* 自定义答案（不在选项列表中的答案） */}
        {qa.answers
          .filter(a => !qa.options.some(o => o.label === a))
          .map((customAnswer, idx) => (
            <span
              key={`custom-${idx}`}
              className="inline-flex items-center px-2.5 py-1 text-[12px] rounded-md border border-text-100 text-text-100 bg-bg-300/40"
            >
              {customAnswer}
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
