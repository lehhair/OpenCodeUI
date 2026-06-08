# TPS & TTFT Display for Step-Finish Info

## Overview

Add tokens-per-second (TPS) and time-to-first-token (TTFT) display to the step-finish info bar in assistant messages. Both metrics are computed from existing API timestamp fields (`AssistantMessage.time`, `TextPart.time.start`, `ReasoningPart.time.start`).

## Background

All timestamps come from the opencode server's `Date.now()`:

| Field | Source | When set |
|---|---|---|
| `AssistantMessage.time.created` | opencode server | When LLM call is initiated |
| `AssistantMessage.time.completed` | opencode server | When LLM stream finishes |
| `TextPart.time.start` | opencode server | When first text chunk arrives |
| `ReasoningPart.time.start` | opencode server | When first reasoning chunk arrives |

These are server wall-clock times, meaning TTFT includes network latency to the LLM provider plus the provider's internal processing time. TPS reflects the effective generation throughput as observed by the opencode server.

## Formulas

```
TTFT       = firstPartStart - created
genTime    = completed - firstPartStart
TPS        = (tokens.output + tokens.reasoning) / (genTime / 1000)
```

Where `firstPartStart` is the earliest `time.start` across all `text` and `reasoning` parts in the message.

## Display

```
· 42 T/s · TTFT 1.2s
```

- Placed after `tokens` in the step-finish line
- TPS shown as integer (e.g., `42 T/s`)
- TTFT uses existing `formatDuration()` (e.g., `1.2s`, `342ms`)
- Only shown on the **last step-finish** in a message (same condition as `completedAt`/`duration`)
- Only shown when data is available (parts exist with `time.start`, `completed` is present)

## Configuration

Two new independent toggles in `StepFinishDisplay` (both default `true`):

```
ttft: boolean
tps: boolean
```

Settings page (Chat → Step Finish Info) adds two new rows:

| Toggle | Label | Description |
|---|---|---|
| ttft | "TTFT" | "Show time to first token (computed from opencode API timestamps, includes LLM network overhead)" |
| tps | "Throughput" | "Show tokens per second (computed from opencode API timestamps, includes LLM network overhead)" |

## Data Flow

```
AssistantMessageView (MessageRenderer.tsx)
  │
  ├─ parts から 最早の time.start を抽出 → firstPartStart
  ├─ info.time.created を抽出                    → created
  ├─ info.time.completed を抽出                  → completed
  │
  └─ StepFinishPartView
       props: { part, duration?, firstPartStart?, created?, completed?, ... }
```

## Files Changed

| File | Change |
|---|---|
| `src/store/themeStore.ts` | Add `ttft`, `tps` to `StepFinishDisplay` interface and defaults |
| `src/features/message/parts/StepFinishPartView.tsx` | Add `firstPartStart`, `created` props; compute and render TTFT/TPS |
| `src/features/message/MessageRenderer.tsx` | Extract `firstPartStart` from parts; pass `created`, `firstPartStart` to StepFinishPartView |
| `src/features/settings/components/ChatSettings.tsx` | Add TTFT/TPS toggle rows |
| `src/locales/en/settings.json` | Add `ttft`/`showTtft`, `tps`/`showTps` keys |
| `src/locales/zh-CN/settings.json` | Same in Chinese |
| `src/features/message/MessageRenderer.test.tsx` | Update mock to include new props |
| `src/features/message/parts/StepFinishPartView.test.tsx` | Add tests for TTFT/TPS display (if exists) |

## Tests

- `StepFinishPartView`: Test TTFT/TPS display when data present; verify hidden when data missing
- `MessageRenderer`: Ensure `firstPartStart` is correctly extracted from parts

## Not in Scope

- Session-level TPS aggregation
- Real-time TPS during streaming
- Tool-call-only steps (no `text`/`reasoning` parts)
- `formatUtils.ts` changes (TTFT reuses `formatDuration`)
