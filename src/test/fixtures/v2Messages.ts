// ============================================
// V2 消息测试夹具（阶段 2a）
// ============================================
//
// 为什么要单独放一个文件：
//   阶段 2a 把消息模型从 V1 的 `{info, parts}` 两层换成了 V2 的扁平联合
//   （`Session.Message.Info`，11 种）。大量测试原本手工拼 V1 结构，
//   换成 V2 后字段名全变（`role` → `type`、`modelID` → `model.id` …）。
//   这里集中提供构造器，避免每个测试各写一份、字段名写错还看不出来。
//
// ⚠️ 这些构造器**刻意保持最小字段集**（只填 V2 schema 里的必填项），
//    这样一旦 V2 把某个字段变成必填，测试会立刻报错而不是静默通过。

import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageCompaction,
  SessionMessageCompactionCompleted,
  SessionMessageCompactionFailed,
  SessionMessageInfo,
  SessionMessageSystem,
  SessionMessageUser,
  SessionMessageIdle,
} from '../../types/api/message'

/** 造一条 V2 user 消息 */
export function v2User(id: string, text: string, extra?: Partial<SessionMessageUser>): SessionMessageUser {
  return {
    id,
    type: 'user',
    time: { created: 1 },
    text,
    ...extra,
  }
}

/** 造一条 V2 assistant 消息（默认：单条 text 内容 + 已结束） */
export function v2Assistant(
  id: string,
  text: string,
  extra?: Partial<SessionMessageAssistant>,
): SessionMessageAssistant {
  return {
    id,
    type: 'assistant',
    time: { created: 1, completed: 2 },
    agent: 'build',
    model: { id: 'model-1', providerID: 'provider-1' },
    content: [{ type: 'text', text }],
    finish: 'stop',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...extra,
  }
}

/** 造一条**流式中**的 assistant（没有 completed，也没有 finish） */
export function v2StreamingAssistant(id: string, text: string): SessionMessageAssistant {
  const message = v2Assistant(id, text)
  return {
    ...message,
    time: { created: 1 },
    finish: undefined,
  }
}

/** 造一条 V2 assistant 里的 tool 内容块 */
export function v2Tool(
  id: string,
  name: string,
  extra?: Partial<SessionMessageAssistantTool>,
): SessionMessageAssistantTool {
  return {
    type: 'tool',
    id,
    name,
    state: { status: 'completed', input: {}, content: [{ type: 'text', text: 'ok' }] },
    time: { created: 1, ran: 1, completed: 2 },
    ...extra,
  }
}

/** 造一条 V2 system 消息 */
export function v2System(id: string, text: string, description?: string): SessionMessageSystem {
  return {
    id,
    type: 'system',
    time: { created: 1 },
    text,
    ...(description === undefined ? {} : { description }),
  }
}

/** 造一条 V2 idle 标记（一轮结束） */
export function v2Idle(id: string): SessionMessageIdle {
  return { id, type: 'idle', time: { created: 2 }, outcome: 'succeeded' }
}

/** 造一条 V2 compaction 消息（默认：已完成） */
export function v2Compaction(
  id: string,
  extra?: Partial<SessionMessageCompactionCompleted> | Partial<SessionMessageCompactionFailed>,
): SessionMessageCompaction {
  return {
    id,
    type: 'compaction',
    status: 'completed',
    time: { created: 3 },
    reason: 'manual',
    summary: 'summary text',
    recent: 'recent text',
    ...extra,
  } as SessionMessageCompaction
}

/** 通用：把任意 V2 消息包成数组（方便喂 setMessages / prependMessages） */
export function v2Page(...messages: SessionMessageInfo[]): SessionMessageInfo[] {
  return messages
}
