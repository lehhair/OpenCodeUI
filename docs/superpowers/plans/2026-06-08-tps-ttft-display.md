# TPS & TTFT Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tokens-per-second (TPS) and time-to-first-token (TTFT) display to step-finish info bar.

**Architecture:** New props flow from `MessageRenderer.tsx` → `StepFinishPartView.tsx`. Two new toggles added to `StepFinishDisplay` in `themeStore.ts`. TTFT reuses existing `formatDuration()`, TPS formatted inline as integer.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, i18next, Vitest + Testing Library

---

### Task 1: Add `ttft` and `tps` to StepFinishDisplay

**Files:**
- Modify: `src/store/themeStore.ts` (interface + defaults)

- [ ] **Step 1: Add fields to interface**

Edit `src/store/themeStore.ts`, add `ttft` and `tps` to `StepFinishDisplay`:

```typescript
export interface StepFinishDisplay {
  tokens: boolean
  tps: boolean
  cache: boolean
  cost: boolean
  duration: boolean
  turnDuration: boolean
  agent: boolean
  model: boolean
  completedAt: boolean
  ttft: boolean
}
```

- [ ] **Step 2: Set defaults to true**

Edit `DEFAULT_STEP_FINISH_DISPLAY`:

```typescript
const DEFAULT_STEP_FINISH_DISPLAY: StepFinishDisplay = {
  tokens: true,
  tps: true,
  cache: true,
  cost: true,
  duration: true,
  turnDuration: true,
  agent: false,
  model: false,
  completedAt: false,
  ttft: true,
}
```

- [ ] **Step 3: Commit**

```bash
git add src/store/themeStore.ts
git commit -m "feat: add ttft and tps to StepFinishDisplay"
```

---

### Task 2: Add i18n entries for TTFT/TPS settings

**Files:**
- Modify: `src/locales/en/settings.json`
- Modify: `src/locales/zh-CN/settings.json`

- [ ] **Step 1: Add English entries**

Insert after the `showTokenUsage` entry in `src/locales/en/settings.json`:

```json
    "tps": "Throughput",
    "showTps": "Show tokens per second (computed from opencode API timestamps, includes LLM network overhead)",
```

Insert after the `showCompletedAt` entry (near the end of the step-finish section):

```json
    "ttft": "TTFT",
    "showTtft": "Show time to first token (computed from opencode API timestamps, includes LLM network overhead)",
```

- [ ] **Step 2: Add Chinese entries**

Insert after the `showTokenUsage` entry in `src/locales/zh-CN/settings.json`:

```json
    "tps": "吞吐量",
    "showTps": "显示每秒 Token 数（基于 opencode API 时间戳计算，包含 LLM 网络消耗）",
```

Insert after the `showCompletedAt` entry:

```json
    "ttft": "TTFT",
    "showTtft": "显示首 Token 延迟（基于 opencode API 时间戳计算，包含 LLM 网络消耗）",
```

- [ ] **Step 3: Commit**

```bash
git add src/locales/en/settings.json src/locales/zh-CN/settings.json
git commit -m "feat: add i18n entries for TPS and TTFT settings"
```

---

### Task 3: Add TTFT/TPS toggle rows to ChatSettings

**Files:**
- Modify: `src/features/settings/components/ChatSettings.tsx`

- [ ] **Step 1: Add toggle rows**

In `src/features/settings/components/ChatSettings.tsx`, find the step-finish section (around line 96-128). Add two new entries after the `tokens` entry:

```tsx
            { key: 'tps', label: t('chat.tps'), desc: t('chat.showTps') },
```

After the `completedAt` entry:

```tsx
            { key: 'ttft', label: t('chat.ttft'), desc: t('chat.showTtft') },
```

The full array should look like:

```tsx
          {(
            [
              { key: 'agent', label: t('chat.agent'), desc: t('chat.showAgent') },
              { key: 'model', label: t('chat.model'), desc: t('chat.showModel') },
              { key: 'tokens', label: t('chat.tokens'), desc: t('chat.showTokenUsage') },
              { key: 'tps', label: t('chat.tps'), desc: t('chat.showTps') },
              { key: 'cache', label: t('chat.cache'), desc: t('chat.showCacheHit') },
              { key: 'cost', label: t('chat.cost'), desc: t('chat.showApiCost') },
              { key: 'duration', label: t('chat.duration'), desc: t('chat.showResponseTime') },
              { key: 'turnDuration', label: t('chat.totalDuration'), desc: t('chat.showTurnElapsed') },
              { key: 'ttft', label: t('chat.ttft'), desc: t('chat.showTtft') },
              { key: 'completedAt', label: t('chat.completedAt'), desc: t('chat.showCompletedAt') },
            ] as const
          ).map(...)
```

- [ ] **Step 2: Commit**

```bash
git add src/features/settings/components/ChatSettings.tsx
git commit -m "feat: add TPS and TTFT toggle rows to settings"
```

---

### Task 4: Add `firstPartStart` and `created` props to StepFinishPartView, compute and render TTFT/TPS

**Files:**
- Modify: `src/features/message/parts/StepFinishPartView.tsx`
- Create: `src/features/message/parts/StepFinishPartView.test.tsx`

- [ ] **Step 1: Add new props and compute TTFT/TPS**

Edit `src/features/message/parts/StepFinishPartView.tsx`:

Add `firstPartStart` and `created` to the interface:

```typescript
interface StepFinishPartViewProps {
  part: StepFinishPart
  /** 单条消息耗时（毫秒） */
  duration?: number
  /** 整个回合总耗时（毫秒），从用户发送到最后一条 assistant 完成 */
  turnDuration?: number
  /** agent 名称（来自消息 info） */
  agent?: string
  /** model 显示名（来自消息 info） */
  modelLabel?: string
  /** 消息完成时间戳（毫秒），用于显示完成时刻 */
  completedAt?: number
  /** 消息创建时间戳（毫秒），来自 AssistantMessage.time.created */
  created?: number
  /** 消息中最早 part.time.start（毫秒时间戳），用于计算 TTFT/TPS */
  firstPartStart?: number
}
```

Update the destructuring in the component:

```typescript
export const StepFinishPartView = memo(function StepFinishPartView({
  part,
  duration,
  turnDuration,
  agent,
  modelLabel,
  completedAt,
  created,
  firstPartStart,
}: StepFinishPartViewProps) {
```

Compute TTFT and TPS after the existing `cacheHit` line:

```typescript
  const totalTokens = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  const cacheHit = tokens.cache.read

  // TTFT & TPS — 只有最后一条 step-finish 有 completedAt 和 firstPartStart
  const ttft = created != null && firstPartStart != null ? firstPartStart - created : undefined
  const genTime = completedAt != null && firstPartStart != null ? completedAt - firstPartStart : undefined
  const genTokens = tokens.output + tokens.reasoning
  const tps = genTime != null && genTime > 0 && genTokens > 0 ? Math.round(genTokens / (genTime / 1000)) : undefined
```

Update `hasAny` to include the new fields:

```typescript
  const hasAny =
    (show.agent && !!agent) ||
    (show.model && !!modelLabel) ||
    (show.tokens && totalTokens > 0) ||
    (show.tps && tps != null) ||
    (show.cache && cacheHit > 0) ||
    (show.cost && cost > 0) ||
    (show.duration && duration != null && duration > 0) ||
    (show.turnDuration && turnDuration != null && turnDuration > 0) ||
    (show.ttft && ttft != null) ||
    (show.completedAt && completedAt != null)
  if (!hasAny) return null
```

Add TTFT and TPS display after the tokens span (after line 63):

```tsx
      {show.tokens && totalTokens > 0 && (
        <span
          title={`${t('stepFinish.inputTokens', { input: tokens.input })}, ${t('stepFinish.outputTokens', { output: tokens.output })}, ${t('stepFinish.reasoningTokens', { reasoning: tokens.reasoning })}, ${t('stepFinish.cacheRead', { read: tokens.cache.read })}, ${t('stepFinish.cacheWrite', { write: tokens.cache.write })}`}
        >
          {formatNumber(totalTokens)} {t('tokens')}
        </span>
      )}
      {show.tps && tps != null && (
        <span>{tps} T/s</span>
      )}
```

Add TTFT after turnDuration and before completedAt (around line 76-78):

```tsx
      {show.ttft && ttft != null && (
        <span>TTFT {formatDuration(ttft)}</span>
      )}
```

The full render area should look like:

```tsx
      {show.agent && agent && <span className="capitalize">{agent}</span>}
      {show.model && modelLabel && <span>{modelLabel}</span>}
      {show.tokens && totalTokens > 0 && (
        <span
          title={`${t('stepFinish.inputTokens', { input: tokens.input })}, ${t('stepFinish.outputTokens', { output: tokens.output })}, ${t('stepFinish.reasoningTokens', { reasoning: tokens.reasoning })}, ${t('stepFinish.cacheRead', { read: tokens.cache.read })}, ${t('stepFinish.cacheWrite', { write: tokens.cache.write })}`}
        >
          {formatNumber(totalTokens)} {t('tokens')}
        </span>
      )}
      {show.tps && tps != null && (
        <span>{tps} T/s</span>
      )}
      {show.cache && cacheHit > 0 && (
        <span
          className="text-text-600"
          title={`${t('stepFinish.cacheRead', { read: tokens.cache.read })}, ${t('stepFinish.cacheWrite', { write: tokens.cache.write })}`}
        >
          ({t('stepFinish.cached', { count: formatNumber(cacheHit) })})
        </span>
      )}
      {show.cost && cost > 0 && <span>{formatCost(cost)}</span>}
      {show.duration && duration != null && duration > 0 && <span>{formatDuration(duration)}</span>}
      {show.turnDuration && turnDuration != null && turnDuration > 0 && (
        <span>{t('stepFinish.totalDuration', { duration: formatDuration(turnDuration) })}</span>
      )}
      {show.ttft && ttft != null && (
        <span>TTFT {formatDuration(ttft)}</span>
      )}
      {show.completedAt && completedAt != null && (
        <span title={formatDetailedDateTime(completedAt)}>{formatCompletedAt(completedAt, completedAtFormat)}</span>
      )}
```

- [ ] **Step 2: Write the failing test**

Create `src/features/message/parts/StepFinishPartView.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StepFinishPartView } from './StepFinishPartView'
import type { StepFinishPart } from '../../../types/message'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'stepFinish.inputTokens') return `Input: ${opts?.input}`
      if (key === 'stepFinish.outputTokens') return `Output: ${opts?.output}`
      if (key === 'stepFinish.reasoningTokens') return `Reasoning: ${opts?.reasoning}`
      if (key === 'stepFinish.cacheRead') return `Cache read: ${opts?.read}`
      if (key === 'stepFinish.cacheWrite') return `Cache write: ${opts?.write}`
      if (key === 'stepFinish.cached') return `${opts?.count} cached`
      if (key === 'stepFinish.totalDuration') return `${opts?.duration} total`
      if (key === 'tokens') return 'tokens'
      return key
    },
  }),
}))

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({
    stepFinishDisplay: {
      tokens: true,
      tps: true,
      cache: true,
      cost: true,
      duration: true,
      turnDuration: true,
      agent: true,
      model: true,
      completedAt: true,
      ttft: true,
    },
    completedAtFormat: 'time' as const,
  }),
}))

function createStepFinishPart(overrides?: Partial<StepFinishPart>): StepFinishPart {
  return {
    id: 'step-finish-1',
    sessionID: 'session-1',
    messageID: 'msg-1',
    type: 'step-finish',
    reason: 'stop',
    cost: 0,
    tokens: {
      input: 100,
      output: 200,
      reasoning: 50,
      cache: { read: 0, write: 0 },
    },
    ...overrides,
  }
}

describe('StepFinishPartView', () => {
  it('renders TPS when tps and firstPartStart are provided', () => {
    render(
      <StepFinishPartView
        part={createStepFinishPart()}
        duration={10000}
        completedAt={20000}
        created={5000}
        firstPartStart={6000}
      />,
    )
    // created=5000, firstPartStart=6000 → TTFT=1000ms
    // completedAt=20000, firstPartStart=6000 → genTime=14000ms
    // genTokens=250 (output 200 + reasoning 50)
    // tps = Math.round(250 / (14000/1000)) = Math.round(17.857) = 18
    expect(screen.getByText('18 T/s')).toBeInTheDocument()
  })

  it('renders TTFT when ttft and firstPartStart are provided', () => {
    render(
      <StepFinishPartView
        part={createStepFinishPart()}
        duration={10000}
        completedAt={20000}
        created={5000}
        firstPartStart={6000}
      />,
    )
    expect(screen.getByText(/TTFT/)).toBeInTheDocument()
    expect(screen.getByText(/1s/)).toBeInTheDocument()
  })

  it('does not render TPS when no firstPartStart', () => {
    render(
      <StepFinishPartView
        part={createStepFinishPart()}
        completedAt={20000}
      />,
    )
    expect(screen.queryByText(/T\/s/)).toBeNull()
  })

  it('does not render TTFT when no firstPartStart', () => {
    render(
      <StepFinishPartView
        part={createStepFinishPart()}
        completedAt={20000}
      />,
    )
    expect(screen.queryByText(/TTFT/)).toBeNull()
  })

  it('does not render TTFT/TPS when toggled off in settings', () => {
    vi.mocked(require('../../../hooks/useTheme').useTheme).mockReturnValue({
      stepFinishDisplay: {
        tokens: true,
        tps: false,
        cache: true,
        cost: true,
        duration: true,
        turnDuration: true,
        agent: true,
        model: true,
        completedAt: false,
        ttft: false,
      },
      completedAtFormat: 'time' as const,
    })

    render(
      <StepFinishPartView
        part={createStepFinishPart()}
        duration={10000}
        completedAt={20000}
        created={5000}
        firstPartStart={6000}
      />,
    )
    expect(screen.queryByText(/T\/s/)).toBeNull()
    expect(screen.queryByText(/TTFT/)).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/message/parts/StepFinishPartView.test.tsx`
Expected: FAIL with type errors (new props not in component yet)

- [ ] **Step 4: Implement the component changes** (already done in Step 1)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/message/parts/StepFinishPartView.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/message/parts/StepFinishPartView.tsx src/features/message/parts/StepFinishPartView.test.tsx
git commit -m "feat: add TTFT and TPS display to StepFinishPartView"
```

---

### Task 5: Extract `firstPartStart` from parts and pass new props in MessageRenderer

**Files:**
- Modify: `src/features/message/MessageRenderer.tsx`

- [ ] **Step 1: Extract firstPartStart from parts**

In `src/features/message/MessageRenderer.tsx`, inside `AssistantMessageView`, add after the `hasCopyableText` line (around line 417):

```tsx
  // 最早 part.time.start，用于 TTFT/TPS 计算
  const firstPartStart = useMemo(() => {
    for (const p of parts) {
      if ((p.type === 'text' || p.type === 'reasoning') && p.time?.start) {
        return p.time.start
      }
    }
    return undefined
  }, [parts])
```

Make sure to add `useMemo` to the imports.

- [ ] **Step 2: Pass new props to StepFinishPartView**

Find the two `<StepFinishPartView` usages and add `created` and `firstPartStart`:

First usage (line 490-497):
```tsx
                  <StepFinishPartView
                    key={part.id}
                    part={part}
                    duration={isLastStepFinish ? duration : undefined}
                    turnDuration={isLastStepFinish ? turnDuration : undefined}
                    agent={agent}
                    modelLabel={modelLabel}
                    completedAt={isLastStepFinish ? completed : undefined}
                    created={isLastStepFinish ? created : undefined}
                    firstPartStart={isLastStepFinish ? firstPartStart : undefined}
                  />
```

Second usage (ToolGroup, line 737-744):
```tsx
            <StepFinishPartView
              part={stepFinish}
              duration={duration}
              turnDuration={turnDuration}
              agent={agent}
              modelLabel={modelLabel}
              completedAt={completedAt}
              created={created}
              firstPartStart={firstPartStart}
            />
```

Also add `created` and `firstPartStart` to the `ToolGroupProps` interface and destructuring:

```tsx
interface ToolGroupProps {
  parts: ToolPart[]
  stepFinish?: StepFinishPart
  duration?: number
  turnDuration?: number
  isStreaming?: boolean
  agent?: string
  modelLabel?: string
  completedAt?: number
  created?: number
  firstPartStart?: number
}
```

And in the destructuring (line 555-563 area):
```tsx
  duration,
  turnDuration,
  isStreaming,
  agent,
  modelLabel,
  completedAt,
  created,
  firstPartStart,
```



- [ ] **Step 3: Run existing tests to verify nothing broke**

Run: `npx vitest run src/features/message/MessageRenderer.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/features/message/MessageRenderer.tsx
git commit -m "feat: extract firstPartStart and pass created/firstPartStart to StepFinishPartView"
```

---

### Task 6: Type check and verify build

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Final commit if needed**

```bash
git add -A
git commit -m "chore: fix type and test issues"
```
