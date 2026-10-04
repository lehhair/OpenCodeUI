# OpenCode v2 — Message & Event Type Reference

Extracted verbatim from the installed client package. Nothing here is inferred; every
declaration below was copied out of the `.d.ts` source listed under **Sources**.

## Sources

| Role | Path |
| --- | --- |
| Generated types (primary, ~256 KB) | `node_modules/@opencode/client/dist/promise/generated/types.d.ts` |
| Generated client methods | `node_modules/@opencode/client/dist/promise/generated/client.d.ts` |
| Public `make()` client surface | `node_modules/@opencode/client/dist/promise/client.d.ts` |
| Authoring schema (cross-check, self-referential forms) | `node_modules/@opencode/schema/dist/**` |
| **v1** SDK, used for the method-mapping table | `node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts` |

Versions: `@opencode/client` **2.0.21**, `@opencode/schema` **2.0.21**, `@opencode-ai/sdk` (v1) **1.16.0**.

Extraction used the bundled helper:

```
node node_modules/v2-types.mjs <TypeName...>
```

### About the "self-referential lookup" form

Many `*Input` types in `generated/types.d.ts` are emitted as a lookup against an inline
object literal, e.g.:

```ts
export type SessionMessageGetInput = {
    readonly sessionID: { readonly sessionID: string; readonly messageID: string; }["sessionID"];
    readonly messageID: { readonly sessionID: string; readonly messageID: string; }["messageID"];
};
```

The object literal after the property name is the *whole* struct; `["prop"]` selects one
field of it. The real type is therefore just the inner object literal with `readonly`
preserved. Where that occurs below, the declaration is shown **as declared**, followed by a
**Collapsed** line giving the actual shape. This happens for every mutation/query input
type whose schema is a `Schema.Struct` with more than one field.

---

## 1. Session messages

### 1.1 The message union

```ts
export type SessionMessageInfo =
    | SessionMessageAgentSelected
    | SessionMessageModelSelected
    | SessionMessageLocationSwitched
    | SessionMessageUser
    | SessionMessageSynthetic
    | SessionMessageSystem
    | SessionMessageSkill
    | SessionMessageShell
    | SessionMessageAssistant
    | SessionMessageCompaction
    | SessionMessageIdle;
```

Discriminant field: **`type`**. The eleven values are
`"agent-switched"`, `"model-switched"`, `"location-switched"`, `"user"`, `"synthetic"`,
`"system"`, `"skill"`, `"shell"`, `"assistant"`, `"compaction"`, `"idle"`.

Every member except `SessionMessageAssistant` and `SessionMessageIdle` carries the common
envelope `id: string`, `metadata?: { [x: string]: JsonValue }`, `time`.

### 1.2 `SessionMessageUser`

```ts
export type SessionMessageUser = {
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
    };
    text: string;
    files?: Array<PromptFileAttachment>;
    agents?: Array<PromptAgentAttachment>;
    skills?: Array<PromptSkillAttachment>;
    type: "user";
};
```

### 1.3 `SessionMessageAssistant`

```ts
export type SessionMessageAssistant = {
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
        streamed?: number;
        completed?: number;
    };
    type: "assistant";
    agent: string;
    model: ModelRef;
    content: Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>;
    snapshot?: {
        start?: string;
        end?: string;
        files?: Array<string>;
    };
    finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown";
    rawFinish?: string;
    providerState?: SessionMessageProviderState;
    cost?: MoneyUSD;
    tokens?: TokenUsageInfo;
    error?: SessionStructuredError;
    retry?: SessionMessageAssistantRetry;
};
```

> **The array field is named `content`, not `parts` and not `blocks`.** There is no `parts`
> field and no `blocks` field anywhere on `SessionMessageAssistant`.

### 1.4 `SessionMessageSystem`

```ts
export type SessionMessageSystem = {
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
    };
    type: "system";
    text: string;
    description?: string;
};
```

### 1.5 `SessionMessageSynthetic`

```ts
export type SessionMessageSynthetic = {
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
    };
    text: string;
    description?: string;
    type: "synthetic";
};
```

### 1.6 `SessionMessageSkill`

```ts
export type SessionMessageSkill = {
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
    };
    type: "skill";
    skill: string;
    name: string;
    text: string;
};
```

### 1.7 `SessionMessageShell`

```ts
export type SessionMessageShell = {
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
        completed?: number;
    };
    type: "shell";
    shellID: string;
    command: string;
    status: "running" | "exited" | "timeout" | "killed";
    exit?: number | "Infinity" | "-Infinity" | "NaN";
    output?: {
        output: string;
        cursor: number;
        size: number;
        truncated: boolean;
    };
};
```

### 1.8 `SessionMessageAgentSelected`

```ts
export type SessionMessageAgentSelected = {
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
    };
    type: "agent-switched";
    agent: string;
    previous?: string;
};
```

### 1.9 `SessionMessageModelSelected`

```ts
export type SessionMessageModelSelected = {
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
    };
    type: "model-switched";
    model: ModelRef;
    previous?: ModelRef;
};
```

### 1.10 `SessionMessageLocationSwitched`

```ts
export type SessionMessageLocationSwitched = {
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
    };
    type: "location-switched";
    projectID?: string;
    subpath?: string;
    location: LocationPublicRef;
    previous?: {
        location: LocationPublicRef;
        projectID?: string;
        subpath?: string;
    } | null;
};
```

### 1.11 Compaction messages

All three compaction messages share `type: "compaction"` and are discriminated by
`status`.

```ts
export type SessionMessageCompactionRunning = {
    type: "compaction";
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
    };
    status: "running";
    reason: "auto" | "manual";
    summary: string;
    recent: string;
};
```

```ts
export type SessionMessageCompactionCompleted = {
    type: "compaction";
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
    };
    status: "completed";
    reason: "auto" | "manual";
    model?: ModelRef;
    providerState?: SessionMessageProviderState;
    summary: string;
    recent: string;
    providerContext?: SessionProviderContext;
    cost?: MoneyUSD;
    tokens?: TokenUsageInfo;
};
```

```ts
export type SessionMessageCompactionFailed = {
    type: "compaction";
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
    };
    status: "failed";
    reason: "auto" | "manual";
    error: SessionStructuredError;
    cost?: MoneyUSD;
    tokens?: TokenUsageInfo;
};
```

```ts
export type SessionMessageCompaction =
    | SessionMessageCompactionRunning
    | SessionMessageCompactionCompleted
    | SessionMessageCompactionFailed;
```

Note `summary` / `recent` are **required** on `running` and `completed`, and **absent** on
`failed`.

### 1.12 `SessionMessageIdle`

```ts
export type SessionMessageIdle = {
    id: string;
    metadata?: {
        [x: string]: JsonValue;
    };
    time: {
        created: number;
    };
    type: "idle";
    outcome: "succeeded" | "failed" | "interrupted";
};
```

### 1.13 Message listing / retrieval

```ts
export type SessionMessagesResponse = {
    data: Array<SessionMessageInfo>;
    cursor: {
        previous?: string | null;
        next?: string | null;
    };
};
```

```ts
export type SessionMessageGetOutput = {
    data: SessionMessageInfo;
}["data"];
```

**Collapsed:** `SessionMessageGetOutput` = `SessionMessageInfo`.

```ts
export type MessageListInput = {
    readonly sessionID: string;
    readonly limit?: number;
    readonly order?: "asc" | "desc";
    readonly cursor?: string;
    readonly type?:
        | "agent-switched" | "model-switched" | "location-switched" | "user" | "synthetic"
        | "system" | "skill" | "shell" | "assistant" | "compaction";
};
```

```ts
export type MessageListOutput = SessionMessagesResponse;
```

### 1.14 Supporting message types

```ts
export type JsonValue =
    | null | boolean | number | string
    | Array<JsonValue>
    | { [key: string]: JsonValue };
```

```ts
export type ModelRef = {
    id: string;
    providerID: string;
    variant?: string;
};
```

```ts
export type TokenUsageInfo = {
    input: number;
    output: number;
    reasoning: number;
    cache: {
        read: number;
        write: number;
    };
};
```

```ts
export type MoneyUSD = number;
```

```ts
export type SessionStructuredError = {
    type: string;
    message: string;
    status?: number;
    response?: {
        body: string;
    };
};
```

```ts
export type SessionMessageAssistantRetry = {
    attempt: number;
    at: number;
    error: SessionStructuredError;
};
```

```ts
export type SessionMessageProviderState = {
    [x: string]: JsonValue;
};
```

`SessionMessageProviderState1` is the `any`-valued variant used by *event* payloads and the
"encoded" assistant content:

```ts
export type SessionMessageProviderState1 = {
    [x: string]: any;
};
```

```ts
export type SessionMetadata = {
    [x: string]: JsonValue;
};
```

```ts
export type SessionProviderContext = {
    version: 1;
    provenance: SessionProviderContextProvenance;
    messages: JsonValue;
};
```

```ts
export type SessionProviderContextProvenance = {
    providerID: string;
    provider: string;
    modelID: string;
    route: string;
    protocol: string;
    endpoint: string;
};
```

Prompt attachments referenced by `SessionMessageUser`:

```ts
export type PromptFileAttachment = {
    data: PromptBase64;
    mime: string;
    source: PromptFileSource;
    name?: string;
    description?: string;
    mention?: PromptMention;
};
```

```ts
export type PromptAgentAttachment = {
    name: string;
    mention?: PromptMention;
};
```

```ts
export type PromptSkillAttachment = {
    id: string;
    name: string;
    text?: string;
    mention?: PromptMention;
};
```

```ts
export type PromptFileSource = {
    type: "inline";
} | {
    type: "uri";
    uri: string;
};
```

```ts
export type PromptBase64 = string;
```

```ts
export type PromptMention = {
    start: number;
    end: number;
    text: string;
};
```

---

## 2. Assistant content parts (the `content` array)

`SessionMessageAssistant.content` is
`Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>`
— **a discriminated union over `type` with exactly three variants.**

### 2.1 Text part

```ts
export type SessionMessageAssistantText = {
    type: "text";
    text: string;
    state?: SessionMessageProviderState;
};
```

### 2.2 Reasoning part

```ts
export type SessionMessageAssistantReasoning = {
    type: "reasoning";
    text: string;
    state?: SessionMessageProviderState;
    time?: {
        created: number;
        completed?: number;
    };
};
```

### 2.3 Tool part

```ts
export type SessionMessageAssistantTool = {
    type: "tool";
    id: string;
    name: string;
    executed?: boolean;
    providerState?: SessionMessageProviderState;
    providerResultState?: SessionMessageProviderState;
    state:
        | SessionMessageToolStateStreaming
        | SessionMessageToolStateRunning
        | SessionMessageToolStateCompleted
        | SessionMessageToolStateError;
    time: {
        created: number;
        ran?: number;
        completed?: number;
    };
};
```

### 2.4 Tool state (discriminated by `state.status`)

```ts
export type SessionMessageToolStateStreaming = {
    status: "streaming";
    input: string;
};
```

```ts
export type SessionMessageToolStateRunning = {
    status: "running";
    input: {
        [x: string]: JsonValue;
    };
    metadata: {
        [x: string]: JsonValue;
    };
};
```

```ts
export type SessionMessageToolStateCompleted = {
    status: "completed";
    input: {
        [x: string]: JsonValue;
    };
    content: [ToolContent, ...Array<ToolContent>];
    metadata?: {
        [x: string]: JsonValue;
    };
};
```

```ts
export type SessionMessageToolStateError = {
    status: "error";
    input: {
        [x: string]: JsonValue;
    };
    error: SessionStructuredError;
    content?: [ToolContent, ...Array<ToolContent>];
    metadata?: {
        [x: string]: JsonValue;
    };
};
```

Note the progression of `input`: **`string` while `"streaming"`**, then an object from
`"running"` onward. `content` is a **non-empty tuple** `[ToolContent, ...Array<ToolContent>]`.

### 2.5 Tool content

```ts
export type ToolContent = ToolTextContent | ToolFileContent;
```

```ts
export type ToolTextContent = {
    type: "text";
    text: string;
};
```

```ts
export type ToolFileContent = {
    type: "file";
    uri: string;
    mime: string;
    name?: string | null;
};
```

### 2.6 The "encoded" mirror of the content union

Event payloads (`SessionMessageContentUpdated`) and the `/"1"` variants use a parallel set
of types whose only difference is `providerState: { [x: string]: any }` instead of
`JsonValue`, and `name?: string | undefined` instead of `name?: string | null`:

```ts
export type SessionMessageAssistantContentEncoded =
    | SessionMessageAssistantText1
    | SessionMessageAssistantReasoning1
    | SessionMessageAssistantTool1;
```

```ts
export type SessionMessageAssistantText1 = {
    type: "text";
    text: string;
    state?: SessionMessageProviderState1;
};
```

```ts
export type SessionMessageAssistantReasoning1 = {
    type: "reasoning";
    text: string;
    state?: SessionMessageProviderState1;
    time?: {
        created: number;
        completed?: number;
    };
};
```

```ts
export type SessionMessageAssistantTool1 = {
    type: "tool";
    id: string;
    name: string;
    executed?: boolean;
    providerState?: SessionMessageProviderState1;
    providerResultState?: SessionMessageProviderState1;
    state:
        | SessionMessageToolStateStreaming
        | SessionMessageToolStateRunning1
        | SessionMessageToolStateCompleted1
        | SessionMessageToolStateError1;
    time: {
        created: number;
        ran?: number;
        completed?: number;
    };
};
```

```ts
export type SessionMessageToolStateRunning1 = {
    status: "running";
    input: {
        [x: string]: any;
    };
    metadata: {
        [x: string]: JsonValue;
    };
};
```

```ts
export type SessionMessageToolStateCompleted1 = {
    status: "completed";
    input: {
        [x: string]: any;
    };
    content: [ToolContent1, ...Array<ToolContent1>];
    metadata?: {
        [x: string]: JsonValue;
    };
};
```

```ts
export type SessionMessageToolStateError1 = {
    status: "error";
    input: {
        [x: string]: any;
    };
    error: SessionStructuredError;
    content?: [ToolContent1, ...Array<ToolContent1>];
    metadata?: {
        [x: string]: JsonValue;
    };
};
```

```ts
export type ToolContent1 = ToolTextContent | ToolFileContent1;
```

```ts
export type ToolFileContent1 = {
    type: "file";
    uri: string;
    mime: string;
    name?: string | undefined;
};
```

### 2.7 `SessionMessageContentUpdated`

This durable event carries a **full replacement** of the assistant `content` array — the
snapshot form, as opposed to the incremental deltas of §3.

```ts
export type SessionMessageContentUpdated = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.message.content.updated";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        messageID: string;
        content: Array<SessionMessageAssistantContentEncoded>;
    };
};
```

---

## 3. Streaming events

### 3.0 The critical structural fact: hybrid, not either/or

**This is the definitive answer to "does a v2 assistant message stream via a `parts` array
or via separate events?" — it is BOTH, on two different channels, and they are not the same
shape.**

1. **The persisted/durable representation is a single `SessionMessageAssistant` with a
   `content: Array<...>` (not `parts`) discriminated union** (§1.3, §2). Consumers read this
   by listing messages. It is also *replaced wholesale* on
   `session.message.content.updated` (§2.7), which carries `data.content` of type
   `Array<SessionMessageAssistantContentEncoded>`.

2. **Live streaming is delivered as a flat sequence of separate events**, not as mutations
   to a parts array. There are three families:
   - **text**: `session.text.started` → `session.text.delta`* → `session.text.ended`
   - **reasoning**: `session.reasoning.started` → `session.reasoning.delta`* → `session.reasoning.ended`
   - **tool input**: `session.tool.input.started` → `session.tool.input.delta`* → `session.tool.input.ended`,
     then `session.tool.called` → `session.tool.progress`*, ending in
     `session.tool.success` or `session.tool.failed`

   Note `session.tool.progress` is **ephemeral only** — there is no tool-progress end event;
   the tool is terminated by `session.tool.success` / `session.tool.failed`.

3. **There is no `parts` array anywhere in the v2 schema.** There is no
   `PartDelta` event in v2 either — v1 had both `Part` and `PartDelta` under
   `@opencode/schema/dist/v1/session.d.ts`; v2 replaced them with the flat event families
   above plus the `content` array.

4. **Durable vs ephemeral split.** Started/ended/called/success/failed events carry a
   `durable: { aggregateID, seq, version }` block and are replayable through
   `session.log()`. The high-frequency delta events (`session.text.delta`,
   `session.reasoning.delta`, `session.tool.input.delta`, `session.tool.progress`,
   `session.compaction.delta`) carry **no `durable` field** and are ephemeral.

5. **Correlation keys.** Text and reasoning deltas are correlated by
   `data.ordinal` (a number within the assistant message). Tool events are correlated by
   `data.id` (the tool call id). All carry `data.sessionID` and `data.assistantMessageID`.

### 3.1 Text events

```ts
export type SessionTextStarted = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.text.started";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        ordinal: number;
    };
};
```

```ts
export type SessionTextDelta = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.text.delta";
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        ordinal: number;
        delta: string;
    };
};
```

```ts
export type SessionTextEnded = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.text.ended";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        ordinal: number;
        text: string;
        state?: SessionMessageProviderState1;
    };
};
```

### 3.2 Reasoning events

```ts
export type SessionReasoningStarted = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.reasoning.started";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        ordinal: number;
        state?: SessionMessageProviderState1;
    };
};
```

```ts
export type SessionReasoningDelta = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.reasoning.delta";
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        ordinal: number;
        delta: string;
    };
};
```

```ts
export type SessionReasoningEnded = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.reasoning.ended";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        ordinal: number;
        text: string;
        state?: SessionMessageProviderState1;
    };
};
```

### 3.3 Tool input events

```ts
export type SessionToolInputStarted = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.tool.input.started";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        id: string;
        name: string;
    };
};
```

```ts
export type SessionToolInputDelta = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.tool.input.delta";
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        id: string;
        delta: string;
    };
};
```

```ts
export type SessionToolInputEnded = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.tool.input.ended";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        id: string;
        text: string;
    };
};
```

`SessionToolInputEnded.data.text` is the **complete accumulated JSON argument string**
(the concatenation of every `delta`), mirroring `state.input: string` in
`SessionMessageToolStateStreaming`.

### 3.4 Tool lifecycle events

```ts
export type SessionToolCalled = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.tool.called";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        id: string;
        input: {
            [x: string]: any;
        };
        executed: boolean;
        state?: SessionMessageProviderState1;
    };
};
```

```ts
export type SessionToolProgress = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.tool.progress";
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        id: string;
        metadata: {
            [x: string]: JsonValue;
        };
    };
};
```

`SessionToolProgress` is the **only** tool event whose `data.metadata` uses `JsonValue`
rather than `any`.

```ts
export type SessionToolSuccess = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.tool.success";
    durable: {
        aggregateID: string;
        seq: number;
        version: 2;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        id: string;
        content: [ToolContent1, ...Array<ToolContent1>];
        metadata?: {
            [x: string]: JsonValue;
        };
        executed: boolean;
        resultState?: SessionMessageProviderState1;
    };
};
```

```ts
export type SessionToolFailed = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.tool.failed";
    durable: {
        aggregateID: string;
        seq: number;
        version: 2;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        id: string;
        error: SessionStructuredError;
        content?: [ToolContent1, ...Array<ToolContent1>];
        metadata?: {
            [x: string]: JsonValue;
        };
        executed: boolean;
        resultState?: SessionMessageProviderState1;
    };
};
```

Note `version: 2` in the `durable` block of both `SessionToolSuccess` and
`SessionToolFailed` — these were bumped, unlike the other `version: 1` events.

### 3.5 Step events

```ts
export type SessionStepStarted = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.step.started";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        agent: string;
        model: ModelRef;
        snapshot?: string;
        started: number;
    };
};
```

```ts
export type SessionStepStreamed = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.step.streamed";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
    };
};
```

```ts
export type SessionStepEnded = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.step.ended";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        finish: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown";
        rawFinish?: string;
        providerState?: SessionMessageProviderState1;
        cost: MoneyUSD;
        tokens: TokenUsageInfo;
        snapshot?: string;
        files?: Array<string>;
    };
};
```

```ts
export type SessionStepFailed = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.step.failed";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        error: SessionStructuredError;
        finish?: "content-filter";
        rawFinish?: string;
        providerState?: SessionMessageProviderState1;
        cost?: MoneyUSD;
        tokens?: TokenUsageInfo;
        snapshot?: string;
        files?: Array<string>;
    };
};
```

`SessionStepFailed.data.finish` is narrowed to the single literal `"content-filter"`.
`SessionStepEnded` has required `cost`/`tokens`; `SessionStepFailed` has them optional.

There is also a retry event, present in the union but not in the requested list:

```ts
export type SessionRetryScheduled = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.retry.scheduled";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        assistantMessageID: string;
        attempt: number;
        at: number;
        error: SessionStructuredError;
    };
};
```

### 3.6 Idle and status

```ts
export type SessionIdle = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.idle";
    location?: LocationRef;
    data: {
        sessionID: string;
    };
};
```

`SessionIdle` is **ephemeral** (no `durable`). It is distinct from the durable
`SessionMessageIdle` message (§1.12) which additionally carries `outcome`.

```ts
export type SessionStatusUpdated = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.status";
    location?: LocationRef;
    data: {
        sessionID: string;
        status: SessionStatus;
    };
};
```

> The event `type` literal is **`"session.status"`**, even though the exported type name is
> `SessionStatusUpdated`.

```ts
export type SessionStatus =
    | {
          type: "idle";
      }
    | {
          type: "retry";
          attempt: number;
          message: string;
          action?: {
              reason: string;
              provider: string;
              title: string;
              message: string;
              label: string;
              link?: string;
          };
          next: number;
      }
    | {
          type: "busy";
      };
```

```ts
export type SessionActive = {
    type: "running";
};
```

`SessionActive` is the value type of `session.active()`, whose output is
`{ [x: string]: SessionActive }` (keyed by session id).

### 3.7 Session lifecycle events

```ts
export type SessionCreated = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.created";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        projectID: string;
        location: LocationRef;
        subpath?: string;
        parentID?: string;
        slug: string;
        title?: string;
        agent?: string;
        model?: ModelRef;
        metadata?: SessionMetadata;
        permissions?: PermissionRuleset;
        version: string;
    };
};
```

```ts
export type SessionDeleted = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.deleted";
    durable: {
        aggregateID: string;
        seq: number;
        version: 2;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
    };
};
```

```ts
export type SessionRenamed = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.renamed";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        title: string;
    };
};
```

Related session events in the same family (documented for completeness):

- `SessionAgentSelected` — `type: "session.agent.selected"`, `data: { sessionID, agent, previous? }`
- `SessionModelSelected` — `type: "session.model.selected"`, `data: { sessionID, model: ModelRef, previous?: ModelRef }`
- `SessionMoved` — `type: "session.moved"`, `data: { sessionID, location: LocationRef, projectID, subpath? }`
- `SessionMetadataUpdated` — `type: "session.metadata.updated"`, `data: { sessionID, metadata: SessionMetadata }`
- `SessionPermissions` — `type: "session.permissions"`, `data: { sessionID, permissions: PermissionRuleset }`
- `SessionViewed` — `type: "session.viewed"`, `data: { sessionID, idle: number }`
- `SessionForked` — `type: "session.forked"`, `durable.version: 2`, `data: { sessionID, parentID, boundary: SessionForkBoundary, instructions?, instructionEntries? }`
- `SessionUsageUpdated` — `type: "session.usage.updated"`, **ephemeral**, `data: { sessionID, cost, tokens }`
- `SessionUsageRecorded` — `type: "session.usage.recorded"`, `data: { sessionID, source: "title" | "compaction", cost, tokens }`
- `SessionExecutionStarted` / `SessionExecutionSucceeded` — `data: { sessionID }`
- `SessionExecutionFailed` — `data: { sessionID, error: SessionStructuredError }`
- `SessionExecutionInterrupted` — `data: { sessionID, reason: "user" | "shutdown" | "superseded" | "inactivity" }`
- `SessionInstructionsUpdated` — `type: "session.instructions.updated"`, `durable.version: 2`, `data: { sessionID, delta: { [x: string]: string | "removed" }, text? }`
- `SessionSynthetic` — `data: { sessionID, text, description?, metadata? }`
- `SessionSkillActivated` — `data: { sessionID, id, name, text }`
- `SessionShellStarted` — `data: { sessionID, shell: ShellInfo }`
- `SessionShellEnded` — `data: { sessionID, shell: ShellInfo, output: { output, cursor, size, truncated } }`
- `SessionRevertStaged` — `data: { sessionID, revert: SessionRevert }`
- `SessionRevertCleared` — `data: { sessionID }`
- `SessionRevertCommitted` — `data: { sessionID, to: string }`

```ts
export type SessionForkBoundary = {
    type: "before";
    messageID: string;
} | {
    type: "through";
    messageID: string;
};
```

### 3.8 Compaction events

```ts
export type SessionCompactionStarted = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.compaction.started";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        reason: "auto" | "manual";
        recent: string;
        inputID?: string;
    };
};
```

```ts
export type SessionCompactionDelta = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.compaction.delta";
    location?: LocationRef;
    data: {
        sessionID: string;
        text: string;
    };
};
```

```ts
export type SessionCompactionEnded = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.compaction.ended";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        reason: "auto" | "manual";
        model?: ModelRef;
        providerState?: SessionMessageProviderState1;
        providerContext?: SessionProviderContext;
        text: string;
        recent: string;
        cost?: MoneyUSD;
        tokens?: TokenUsageInfo;
    };
};
```

`SessionCompactionDelta.data.text` is already the accumulated text (it is named `text`, not
`delta`, despite being the streaming event).

```ts
export type SessionCompactionFailed = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.compaction.failed";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        reason: "auto" | "manual";
        error: SessionStructuredError;
        inputID?: string;
        cost?: MoneyUSD;
        tokens?: TokenUsageInfo;
    };
};
```

Note the event payloads use `text` where the corresponding *messages* use `summary`
(`SessionMessageCompactionRunning.summary`, `.recent`).

### 3.9 `SessionRevert`

```ts
export type SessionRevert = {
    messageID: string;
    partID?: string;
    snapshot?: string;
    files?: Array<FileDiffInfo>;
};
```

> `partID` survives as a field on `SessionRevert` even though v2 has no `parts`
> array — it is an opaque identifier, not an index into a parts collection.

---

## 4. Permissions

```ts
export type PermissionEffect = "allow" | "deny" | "ask";
```

```ts
export type PermissionReply = "once" | "always" | "reject";
```

```ts
export type PermissionSource = {
    type: "tool";
    messageID: string;
    id: string;
};
```

```ts
export type PermissionRule = {
    action: string;
    resource: string;
    effect: PermissionEffect;
};
```

```ts
export type PermissionRuleset = Array<PermissionRule>;
```

### 4.1 `PermissionRequest`

```ts
export type PermissionRequest = {
    id: string;
    sessionID: string;
    action: string;
    resources: Array<string>;
    save?: Array<string>;
    metadata?: {
        [x: string]: JsonValue;
    };
    source?: PermissionSource;
    message?: string;
};
```

### 4.2 `PermissionAsked`

```ts
export type PermissionAsked = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "permission.asked";
    location?: LocationRef;
    data: {
        id: string;
        sessionID: string;
        action: string;
        resources: Array<string>;
        save?: Array<string>;
        metadata?: {
            [x: string]: any;
        };
        source?: PermissionSource;
        message?: string;
    };
};
```

The event `data` is structurally `PermissionRequest` with `metadata` widened to `any`.
`PermissionAsked` is **ephemeral** (no `durable`).

### 4.3 `PermissionReplied`

```ts
export type PermissionReplied = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "permission.replied";
    location?: LocationRef;
    data: {
        sessionID: string;
        requestID: string;
        reply: PermissionReply;
    };
};
```

### 4.4 `PermissionCreateInput` (as declared)

```ts
export type PermissionCreateInput = {
    readonly sessionID: {
        readonly sessionID: string;
    }["sessionID"];
    readonly id?: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly id: string;
        };
        readonly agent?: string | null;
    }["id"];
    readonly action: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly id: string;
        };
        readonly agent?: string | null;
    }["action"];
    readonly resources: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly id: string;
        };
        readonly agent?: string | null;
    }["resources"];
    readonly save?: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly id: string;
        };
        readonly agent?: string | null;
    }["save"];
    readonly metadata?: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly id: string;
        };
        readonly agent?: string | null;
    }["metadata"];
    readonly source?: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly id: string;
        };
        readonly agent?: string | null;
    }["source"];
    readonly agent?: {
        readonly id?: string | null;
        readonly action: string;
        readonly resources: ReadonlyArray<string>;
        readonly save?: ReadonlyArray<string>;
        readonly metadata?: {
            readonly [x: string]: JsonValue;
        };
        readonly source?: {
            readonly type: "tool";
            readonly messageID: string;
            readonly id: string;
        };
        readonly agent?: string | null;
    }["agent"];
};
```

**Collapsed** — the real type is:

```ts
export type PermissionCreateInput = {
    readonly sessionID: string;
    readonly id?: string | null;
    readonly action: string;
    readonly resources: ReadonlyArray<string>;
    readonly save?: ReadonlyArray<string>;
    readonly metadata?: {
        readonly [x: string]: JsonValue;
    };
    readonly source?: {
        readonly type: "tool";
        readonly messageID: string;
        readonly id: string;
    };
    readonly agent?: string | null;
};
```

Note the `source` here is an **anonymous inline variant** of `PermissionSource` with
optional `messageID` and required `id`, i.e. it is *not* the same as the exported
`PermissionSource` (which has both required). Also `agent` exists only on the input.

### 4.5 `PermissionReplyInput` (as declared)

```ts
export type PermissionReplyInput = {
    readonly sessionID: {
        readonly sessionID: string;
        readonly requestID: string;
    }["sessionID"];
    readonly requestID: {
        readonly sessionID: string;
        readonly requestID: string;
    }["requestID"];
    readonly decision: {
        readonly decision: "once" | "always" | "reject";
        readonly message?: string | undefined;
    }["decision"];
    readonly message?: {
        readonly decision: "once" | "always" | "reject";
        readonly message?: string | undefined;
    }["message"];
};
```

**Collapsed:**

```ts
export type PermissionReplyInput = {
    readonly sessionID: string;
    readonly requestID: string;
    readonly decision: "once" | "always" | "reject";
    readonly message?: string;
};
```

> **Trap:** the reply field is named **`decision`**, not `reply`. The
> `PermissionReplied` *event* uses `reply: PermissionReply`. Also, `permission.reply`
> takes `decision`, but `PermissionReplied.data.reply` echoes it back.

### 4.6 Other permission types

```ts
export type PermissionSavedInfo = {
    id: string;
    projectID: string;
    action: string;
    resource: string;
    time: {
        created: number;
        updated: number;
    };
};
```

```ts
export type PermissionRequestListOutput = {
    location: LocationPublicRef;
    data: Array<PermissionRequest>;
};
```

```ts
export type PermissionListOutput = {
    data: Array<PermissionRequest>;
}["data"];
```

**Collapsed:** `PermissionListOutput` = `Array<PermissionRequest>`.

> Note the asymmetry: `permission.request.list()` returns
> `{ location, data }` (`PermissionRequestListOutput`) while `permission.list()` returns a
> bare `Array<PermissionRequest>`.

---

## 5. Forms

### 5.1 `FormInfo` and `FormDetail`

```ts
export type FormInfo = {
    id: string;
    sessionID: string;
    title: string;
    metadata?: FormMetadata;
    fields: FormFields;
};
```

```ts
export type FormDetail = {
    id: string;
    sessionID: string;
    title: string;
    metadata?: FormMetadata;
    fields: FormFields;
    state: FormState;
};
```

`FormDetail` = `FormInfo` + required `state`. The event `FormCreated` uses the *encoded*
mirror `FormInfo1` instead:

```ts
export type FormInfo1 = {
    id: string;
    sessionID: string;
    title: string;
    metadata?: FormMetadata1;
    fields: FormFields2;
};
```

### 5.2 Fields

```ts
export type FormField =
    | FormStringField
    | FormNumberField
    | FormIntegerField
    | FormBooleanField
    | FormMultiselectField
    | FormExternalField;
```

```ts
export type FormField1 =
    | FormStringField1
    | FormNumberField1
    | FormIntegerField1
    | FormBooleanField1
    | FormMultiselectField1
    | FormExternalField;
```

```ts
export type FormFields = [FormField, ...Array<FormField>];
```

```ts
export type FormFields2 = [FormField1, ...Array<FormField1>];
```

Both are **non-empty tuples** — at least one field is required.

```ts
export type FormStringField = {
    key: string;
    title?: string;
    description?: string;
    required?: boolean;
    hidden?: boolean;
    when?: Array<FormWhen>;
    type: "string";
    format?: "email" | "uri" | "date" | "date-time";
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    placeholder?: string;
    default?: string;
    options?: Array<FormOption>;
    custom?: boolean;
};
```

```ts
export type FormNumberField = {
    key: string;
    title?: string;
    description?: string;
    required?: boolean;
    hidden?: boolean;
    when?: Array<FormWhen>;
    type: "number";
    minimum?: number | "Infinity" | "-Infinity" | "NaN";
    maximum?: number | "Infinity" | "-Infinity" | "NaN";
    default?: number | "Infinity" | "-Infinity" | "NaN";
};
```

```ts
export type FormIntegerField = {
    key: string;
    title?: string;
    description?: string;
    required?: boolean;
    hidden?: boolean;
    when?: Array<FormWhen>;
    type: "integer";
    minimum?: number | "Infinity" | "-Infinity" | "NaN";
    maximum?: number | "Infinity" | "-Infinity" | "NaN";
    default?: number | "Infinity" | "-Infinity" | "NaN";
};
```

```ts
export type FormBooleanField = {
    key: string;
    title?: string;
    description?: string;
    required?: boolean;
    hidden?: boolean;
    when?: Array<FormWhen>;
    type: "boolean";
    default?: boolean;
};
```

```ts
export type FormMultiselectField = {
    key: string;
    title?: string;
    description?: string;
    required?: boolean;
    hidden?: boolean;
    when?: Array<FormWhen>;
    type: "multiselect";
    options: Array<FormOption>;
    minItems?: number;
    maxItems?: number;
    custom?: boolean;
    default?: Array<string>;
};
```

```ts
export type FormExternalField = {
    key: string;
    type: "external";
    url: string;
    title?: string;
    description?: string;
};
```

> The `"external"` variant notably **lacks** `required`, `hidden` and `when`, unlike every
> other field type.

```ts
export type FormOption = {
    value: string;
    label: string;
    description?: string;
};
```

```ts
export type FormWhen = {
    key: string;
    op: "eq" | "neq";
    value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean;
};
```

```ts
export type FormWhen1 = {
    key: string;
    op: "eq" | "neq";
    value: string | number | boolean;
};
```

### 5.3 Values, answers, metadata, state

```ts
export type FormValue = string | number | "Infinity" | "-Infinity" | "NaN" | boolean | Array<string>;
```

```ts
export type FormValue1 = string | number | boolean | Array<string>;
```

```ts
export type FormAnswer = {
    [x: string]: FormValue;
};
```

```ts
export type FormAnswer2 = {
    [x: string]: FormValue1;
};
```

> `FormAnswer2` (used by the `FormReplied` event) **drops the non-finite number literals**
> that `FormAnswer` (used by `FormState.answered`) allows.

```ts
export type FormMetadata = {
    [x: string]: JsonValue;
};
```

```ts
export type FormMetadata1 = {
    [x: string]: any;
};
```

```ts
export type FormState = {
    status: "pending";
} | {
    status: "answered";
    answer: FormAnswer;
} | {
    status: "cancelled";
    message?: string;
};
```

### 5.4 Form events

```ts
export type FormCreated = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "form.created";
    location?: LocationRef;
    data: {
        form: FormInfo1;
    };
};
```

```ts
export type FormReplied = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "form.replied";
    location?: LocationRef;
    data: {
        id: string;
        sessionID: string;
        answer: FormAnswer2;
    };
};
```

```ts
export type FormCancelled = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "form.cancelled";
    location?: LocationRef;
    data: {
        id: string;
        sessionID: string;
    };
};
```

All three form events are **ephemeral** (no `durable`). Note the nested `data.form` in
`FormCreated` but a flat `data.id` / `data.sessionID` in the other two.

```ts
export type FormListOutput = {
    location: LocationPublicRef;
    data: Array<FormInfo>;
};
```

The client also exposes `session.form.*` (see §10), whose outputs are
`{ data: FormInfo }["data"]`, `{ data: FormDetail }["data"]`,
`{ data: Array<FormInfo> }["data"]` → collapsed to `FormInfo`, `FormDetail`,
`Array<FormInfo>`.

---

## 6. Inbox

```ts
export type SessionInboxDelivery = "steer" | "queue";
```

```ts
export type SessionInboxInfo =
    | SessionInboxUser
    | SessionInboxSynthetic
    | SessionInboxCompaction
    | SessionInboxMove;
```

```ts
export type SessionInboxUser = {
    id: string;
    sessionID: string;
    time: {
        created: number;
    };
    type: "user";
    payload: SessionInboxUserPayload;
    delivery: SessionInboxDelivery;
};
```

```ts
export type SessionInboxSynthetic = {
    id: string;
    sessionID: string;
    time: {
        created: number;
    };
    type: "synthetic";
    payload: SessionInboxSyntheticPayload;
    delivery: SessionInboxDelivery;
};
```

```ts
export type SessionInboxCompaction = {
    id: string;
    sessionID: string;
    time: {
        created: number;
    };
    type: "compaction";
    payload: SessionInboxCompactionPayload;
    delivery: SessionInboxDelivery;
};
```

```ts
export type SessionInboxMove = {
    id: string;
    sessionID: string;
    time: {
        created: number;
    };
    type: "move";
    delivery: SessionInboxDelivery;
    payload: SessionInboxMovePayload;
};
```

Note `SessionInboxMove` declares `delivery` **before** `payload`, unlike the other three.

```ts
export type SessionInboxUserPayload = {
    text: string;
    files?: Array<PromptFileAttachment>;
    agents?: Array<PromptAgentAttachment>;
    skills?: Array<PromptSkillAttachment>;
    metadata?: {
        [x: string]: JsonValue;
    };
};
```

```ts
export type SessionInboxSyntheticPayload = {
    text: string;
    description?: string;
    metadata?: {
        [x: string]: JsonValue;
    };
};
```

```ts
export type SessionInboxCompactionPayload = {};
```

```ts
export type SessionInboxMovePayload = {
    projectID: string;
    subpath?: string;
    location: LocationPublicRef;
};
```

The event-facing mirrors (`...1`) differ only in `metadata: { [x: string]: any }` and, for
move, in using `LocationRef` rather than `LocationPublicRef`:

```ts
export type SessionInboxUserPayload1 = {
    text: string;
    files?: Array<PromptFileAttachment>;
    agents?: Array<PromptAgentAttachment>;
    skills?: Array<PromptSkillAttachment>;
    metadata?: {
        [x: string]: any;
    };
};
```

```ts
export type SessionInboxSyntheticPayload1 = {
    text: string;
    description?: string;
    metadata?: {
        [x: string]: any;
    };
};
```

```ts
export type SessionInboxMovePayload1 = {
    location: LocationRef;
    projectID: string;
    subpath?: string;
};
```

```ts
export type SessionInboxItem = {
    type: "user";
    payload: SessionInboxUserPayload1;
    delivery: SessionInboxDelivery;
} | {
    type: "synthetic";
    payload: SessionInboxSyntheticPayload1;
    delivery: SessionInboxDelivery;
} | {
    type: "compaction";
    payload: SessionInboxCompactionPayload;
    delivery: SessionInboxDelivery;
} | {
    type: "move";
    payload: SessionInboxMovePayload1;
    delivery: SessionInboxDelivery;
};
```

### 6.1 Inbox events

```ts
export type SessionInboxEnqueued = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.inbox.enqueued";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        inboxID: string;
        item: SessionInboxItem;
    };
};
```

```ts
export type SessionInboxDelivered = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.inbox.delivered";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        inboxID: string;
    };
};
```

```ts
export type SessionInboxCancelled = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.inbox.cancelled";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        inboxID: string;
    };
};
```

All three are **durable**. There is a fourth, not in the requested list:

```ts
export type SessionInboxDeliveryChanged = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "session.inbox.delivery.changed";
    durable: {
        aggregateID: string;
        seq: number;
        version: 1;
    };
    location?: LocationRef;
    data: {
        sessionID: string;
        inboxID: string;
        delivery: SessionInboxDelivery;
    };
};
```

`session.inbox.list()` returns `{ data: Array<SessionInboxInfo> }["data"]` → collapsed to
`Array<SessionInboxInfo>`.

---

## 7. Location and server

```ts
export type LocationRef = {
    directory: string;
    workspaceID?: string;
};
```

```ts
export type LocationPublicRef = {
    directory: string;
};
```

```ts
export type LocationPublicInfo = {
    directory: string;
    project: {
        id: string;
        directory: string;
        canonical: string;
    };
};
```

```ts
export type ServerInfo = {
    version: string;
    pid: number;
    urls: Array<string>;
    paths: {
        tmp: string;
    };
};
```

`LocationPublicRef` is the *public* (secret-free) form and appears as the `location` field
of nearly every `*ListOutput` / `*CreateOutput` envelope. `LocationRef` is the internal form
used by event `location?` fields.

---

## 8. Files, PTY, worktrees, VCS

### 8.1 `FileDiffInfo`

```ts
export type FileDiffInfo = {
    file: string;
    patch: string;
    additions: number;
    deletions: number;
    status: "added" | "deleted" | "modified";
};
```

### 8.2 PTY

**`PtyInfo` does not exist.** The PTY value type is named **`Pty`**:

```ts
export type Pty = {
    id: string;
    title: string;
    command: string;
    args: Array<string>;
    cwd: string;
    status: "running" | "exited";
    pid: number;
    exitCode?: number;
};
```

```ts
export type PtyListOutput = {
    location: LocationPublicRef;
    data: Array<Pty>;
};
```

```ts
export type PtyCreateOutput = {
    location: LocationPublicRef;
    data: Pty;
};
```

```ts
export type PtyGetOutput = {
    location: LocationPublicRef;
    data: Pty;
};
```

```ts
export type PtyUpdateOutput = {
    location: LocationPublicRef;
    data: Pty;
};
```

Inputs (collapsed):

```ts
export type PtyCreateInput = {
    readonly location?: {
        readonly directory?: string;
    };
    readonly command?: string;
    readonly args?: ReadonlyArray<string>;
    readonly cwd?: string;
    readonly title?: string;
    readonly env?: {
        readonly [x: string]: string;
    };
};
```

```ts
export type PtyUpdateInput = {
    readonly ptyID: string;
    readonly location?: {
        readonly directory?: string;
    };
    readonly title?: string;
    readonly size?: {
        readonly rows: number;
        readonly cols: number;
    };
};
```

```ts
export type PtyGetInput = {
    readonly ptyID: string;
    readonly location?: {
        readonly directory?: string;
    };
};
```

```ts
export type PtyRemoveInput = {
    readonly ptyID: string;
    readonly location?: {
        readonly directory?: string;
    };
};
```

```ts
export type PtyConnectTokenInput = {
    readonly ptyID: string;
    readonly location?: {
        readonly directory?: string;
    };
    readonly "x-opencode-ticket"?: string;
};
```

```ts
export type PtyConnectTokenOutput = {
    location: LocationPublicRef;
    data: PtyTicketConnectToken;
};
```

PTY events:

```ts
export type PtyCreated = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "pty.created";
    location?: LocationRef;
    data: {
        info: Pty;
    };
};
```

```ts
export type PtyUpdated = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "pty.updated";
    location?: LocationRef;
    data: {
        info: Pty;
    };
};
```

```ts
export type PtyExited = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "pty.exited";
    location?: LocationRef;
    data: {
        id: string;
        exitCode: number;
    };
};
```

```ts
export type PtyDeleted = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    };
    type: "pty.deleted";
    location?: LocationRef;
    data: {
        id: string;
    };
};
```

All PTY events are **ephemeral**. Note `pty.created`/`pty.updated` nest the object under
`data.info`, while `pty.exited`/`pty.deleted` use a flat `data.id`.

### 8.3 Worktrees

```ts
export type WorktreeInfo = {
    directory: string;
};
```

```ts
export type WorktreeDirectory = {
    directory: string;
    strategy?: string;
};
```

```ts
export type WorktreeList = Array<WorktreeDirectory>;
```

```ts
export type WorktreeListOutput = WorktreeList;
```

**Collapsed:** `WorktreeListOutput` = `Array<WorktreeDirectory>`.

```ts
export type WorktreeCreateOutput = WorktreeInfo;
```

Inputs (collapsed):

```ts
export type WorktreeListInput = {
    readonly projectID: string;
};
```

```ts
export type WorktreeCreateInput = {
    readonly projectID: string;
    readonly from?: string;
    readonly branch?: string;
    readonly directory?: string;
    readonly name?: string;
};
```

```ts
export type WorktreeRemoveInput = {
    readonly projectID: string;
    readonly directory: string;
    readonly force: boolean;
};
```

```ts
export type WorktreeRefreshInput = {
    readonly projectID: string;
};
```

### 8.4 VCS

```ts
export type VcsInfo = {
    provider?: string;
    branch: VcsBranch;
};
```

```ts
export type VcsBranch = {
    current?: string;
    default?: string;
};
```

```ts
export type VcsBranchList = Array<string>;
```

```ts
export type VcsBase = {
    name: string;
    ref: string;
    source: "reflog" | "default";
};
```

```ts
export type VcsFileStatus = {
    file: string;
    additions: number;
    deletions: number;
    status: "added" | "deleted" | "modified";
};
```

> `VcsFileStatus` is `FileDiffInfo` **minus the `patch` field**.

```ts
export type VcsGetOutput = {
    location: LocationPublicRef;
    data: VcsInfo;
};
```

```ts
export type VcsStatusOutput = {
    location: LocationPublicRef;
    data: Array<VcsFileStatus>;
};
```

```ts
export type VcsDiffOutput = {
    location: LocationPublicRef;
    data: Array<FileDiffInfo>;
};
```

```ts
export type VcsBaseOutput = {
    location: LocationPublicRef;
    data: VcsBase | null;
};
```

Inputs (collapsed):

```ts
export type VcsStatusInput = {
    readonly location?: {
        readonly directory?: string;
    };
};
```

```ts
export type VcsDiffInput = {
    readonly location?: {
        readonly directory?: string;
    };
    readonly mode: "working" | "branch" | "committed";
    readonly base?: string;
    readonly context?: number;
};
```

There is also `VcsBranchListOutput` for `vcs.branch.list()`.

---

## 9. Config, integrations, skills, commands, agents, MCP

### 9.1 `ConfigGetOutput`

`ConfigGetOutput` is **an array**, and `ConfigEntry` is a two-variant union:

```ts
export type ConfigGetOutput = Array<ConfigEntry>;
```

```ts
export type ConfigEntry = {
    type: "document";
    path?: string;
    info: {
        $schema?: string;
        shell?: string;
        model?: string | {
            providerID: string;
            model: string;
            variant?: string;
        };
        default_agent?: string;
        update?: "disable" | "notify" | "auto";
        share?: "manual" | "auto" | "disabled";
        enterprise?: {
            url?: string;
        };
        username?: string;
        permissions?: PermissionRuleset;
        agents?: {
            [x: string]: {
                model?: string | {
                    providerID: string;
                    model: string;
                    variant?: string;
                };
                request?: {
                    headers?: {
                        [x: string]: string;
                    };
                    body?: {
                        [x: string]: JsonValue;
                    };
                };
                system?: string;
                description?: string;
                mode?: "subagent" | "primary" | "all";
                hidden?: boolean;
                color?: string;
                steps?: number;
                disabled?: boolean;
                permissions?: PermissionRuleset;
            };
        };
        snapshots?: boolean;
        watcher?: {
            ignore?: Array<string>;
        };
        formatter?: boolean | {
            [x: string]: {
                disabled?: boolean;
                command?: Array<string>;
                environment?: {
                    [x: string]: string;
                };
                extensions?: Array<string>;
            };
        };
        lsp?: boolean | {
            [x: string]: {
                disabled: true;
            } | {
                command: Array<string>;
                extensions?: Array<string>;
                disabled?: boolean;
                env?: {
                    [x: string]: string;
                };
                initialization?: {
                    [x: string]: JsonValue;
                };
            };
        };
        media?: {
            image?: {
                auto_resize?: boolean;
                max_width?: number;
                max_height?: number;
                max_base64_bytes?: number;
            };
        };
        tool_output?: {
            max_lines?: number;
            max_bytes?: number;
        };
        mcp?: {
            timeout?: {
                startup?: number;
                catalog?: number;
                execution?: number;
            };
            servers?: {
                [x: string]: {
                    type: "local";
                    command: Array<string>;
                    cwd?: string;
                    environment?: {
                        [x: string]: string;
                    };
                    disabled?: boolean;
                    codemode?: boolean;
                    timeout?: {
                        startup?: number;
                        catalog?: number;
                        execution?: number;
                    };
                    protocol?: McpProtocol;
                } | {
                    type: "remote";
                    url: string;
                    headers?: {
                        [x: string]: string;
                    };
                    oauth?: {
                        client_id?: string;
                        client_secret?: string;
                        scope?: string;
                        callback_port?: number;
                        redirect_uri?: string;
                        auth_server_metadata_url?: string;
                    } | false;
                    disabled?: boolean;
                    codemode?: boolean;
                    timeout?: {
                        startup?: number;
                        catalog?: number;
                        execution?: number;
                    };
                    protocol?: McpProtocol;
                };
            };
        };
        compaction?: {
            auto?: boolean;
            keep?: {
                tokens?: number;
            };
            buffer?: number;
        };
        skills?: Array<string>;
        commands?: {
            [x: string]: {
                template: string;
                description?: string;
                agent?: string;
                model?: string | {
                    providerID: string;
                    model: string;
                    variant?: string;
                };
                subagent?: boolean;
                subtask?: boolean;
            };
        };
        instructions?: Array<string>;
        references?: {
            [x: string]: string | {
                repository: string;
                branch?: string;
                description?: string;
                hidden?: boolean;
            } | {
                path: string;
                description?: string;
                hidden?: boolean;
            };
        };
        websearch?: false | {
            provider: "random" | (string & {});
        };
        plugins?: Array<string | {
            package: string;
            options?: {
                [x: string]: JsonValue;
            };
        }>;
        worktree?: ConfigWorktree;
        warming?: boolean | {
            prompt?: string;
            interval?: string;
            duration?: string;
        };
        providers?: {
            [x: string]: {
                canonical?: string;
                name?: string;
                env?: Array<string>;
                package?: string;
                settings?: ConfigProviderSettings;
                headers?: {
                    [x: string]: string;
                };
                body?: {
                    [x: string]: JsonValue;
                };
                models?: {
                    [x: string]: {
                        modelID?: string;
                        family?: string;
                        name?: string;
                        compatibility?: ModelCompatibility;
                        package?: string;
                        settings?: ConfigModelSettings;
                        headers?: {
                            [x: string]: string;
                        };
                        body?: {
                            [x: string]: JsonValue;
                        };
                        capabilities?: ModelCapabilities;
                        variants?: Array<{
                            id: string;
                            settings?: ConfigModelSettings;
                            headers?: {
                                [x: string]: string;
                            };
                            body?: {
                                [x: string]: JsonValue;
                            };
                        }>;
                        cost?: {
                            tier?: {
                                type: "context";
                                size: number;
                            };
                            input: MoneyUSDPerMillionTokens;
                            output: MoneyUSDPerMillionTokens;
                            cache?: {
                                read?: MoneyUSDPerMillionTokens;
                                write?: MoneyUSDPerMillionTokens;
                            };
                        } | Array<{
                            tier?: {
                                type: "context";
                                size: number;
                            };
                            input: MoneyUSDPerMillionTokens;
                            output: MoneyUSDPerMillionTokens;
                            cache?: {
                                read?: MoneyUSDPerMillionTokens;
                                write?: MoneyUSDPerMillionTokens;
                            };
                        }>;
                        disabled?: boolean;
                        limit?: {
                            context?: number;
                            input?: number;
                            output?: number;
                        };
                    };
                };
            };
        };
        experimental?: {
            portable_shell_scanner?: boolean;
            subagent_depth?: number;
            policies?: Array<{
                action: "provider.use" | "permission";
                resource: string;
                effect: "allow" | "deny";
            }>;
        };
    };
} | {
    type: "directory";
    path: string;
};
```

```ts
export type MoneyUSDPerMillionTokens = number;
```

`ModelCompatibility`:

```ts
export type ModelCompatibility = {
    reasoningField?: ModelReasoningField;
    requireReasoning?: boolean;
    maxTokensField?: ModelMaxTokensField;
    requireFinishReason?: boolean;
    requireAssistantAfterTool?: boolean;
    supportsPromptCacheKey?: boolean;
};
```

Where `ModelReasoningField = "reasoning" | "reasoning_content" | "reasoning_text" | (string & {})`
and `ModelMaxTokensField = "max_completion_tokens" | "max_tokens"`.

### 9.2 `IntegrationListOutput`

```ts
export type IntegrationListOutput = {
    location: LocationPublicRef;
    data: Array<IntegrationInfo>;
};
```

```ts
export type IntegrationInfo = {
    id: string;
    name: string;
    metadata?: {
        [x: string]: any;
    };
    methods: Array<IntegrationMethod>;
    connections: Array<ConnectionInfo>;
};
```

```ts
export type IntegrationMethod =
    | IntegrationOAuthMethod
    | IntegrationCommandMethod
    | IntegrationKeyMethod
    | IntegrationEnvMethod;
```

```ts
export type IntegrationOAuthMethod = {
    id: string;
    type: "oauth";
    label: string;
    form?: FormFields;
};
```

```ts
export type IntegrationCommandMethod = {
    id: string;
    type: "command";
    label: string;
    command: Array<string>;
};
```

```ts
export type IntegrationKeyMethod = {
    type: "key";
    label?: string;
    form?: FormFields;
};
```

```ts
export type IntegrationEnvMethod = {
    type: "env";
    names: Array<string>;
};
```

```ts
export type ConnectionInfo = ConnectionCredentialInfo | ConnectionEnvInfo;
```

```ts
export type ConnectionCredentialInfo = {
    type: "credential";
    id: string;
    label: string;
    method: "key" | "oauth";
    status?: ConnectionStatus;
};
```

```ts
export type ConnectionEnvInfo = {
    type: "env";
    name: string;
    status?: ConnectionStatus;
};
```

### 9.3 `SkillListOutput`

```ts
export type SkillListOutput = {
    location: LocationPublicRef;
    data: Array<SkillInfo>;
};
```

```ts
export type SkillInfo = {
    id: string;
    name: string;
    description?: string;
    autoinvoke?: boolean;
    path: string;
    content: string;
};
```

### 9.4 `CommandListOutput`

```ts
export type CommandListOutput = {
    location: LocationPublicRef;
    data: Array<CommandInfo>;
};
```

```ts
export type CommandInfo = {
    name: string;
    description?: string;
};
```

### 9.5 `AgentListOutput`

```ts
export type AgentListOutput = {
    location: LocationPublicRef;
    data: Array<AgentInfo>;
};
```

```ts
export type AgentInfo = {
    id: string;
    name: string;
    model?: ModelRef;
    request: ProviderRequest;
    system?: string;
    description?: string;
    mode: "subagent" | "primary" | "all";
    hidden: boolean;
    color?: AgentColor;
    steps?: number;
    permissions: PermissionRuleset;
};
```

```ts
export type AgentColor = string;
```

```ts
export type ProviderRequest = {
    settings: ProviderSettings;
    headers: {
        [x: string]: string;
    };
    body: {
        [x: string]: any;
    };
};
```

```ts
export type ProviderSettings = {
    timeout?: number | false;
    chunkTimeout?: number;
    compaction?: ProviderCompaction;
    transport?: ProviderTransport;
} & {
    [x: string]: any;
};
```

`AgentListOutput.data` embeds `request`, so `ProviderSettings` (and therefore an open
index signature) is transitively part of `AgentInfo`.

### 9.6 `McpListOutput`

```ts
export type McpListOutput = {
    location: LocationPublicRef;
    data: Array<McpServer>;
};
```

```ts
export type McpServer = {
    name: string;
    status: McpStatusConnected | McpStatusPending | McpStatusDisabled | McpStatusFailed | McpStatusNeedsAuth;
    integrationID?: string;
};
```

> **`McpStatus` does not exist as a named type.** The union is written inline on
> `McpServer.status`. The five variants are:

```ts
export type McpStatusConnected = {
    status: "connected";
};
```

```ts
export type McpStatusPending = {
    status: "pending";
};
```

```ts
export type McpStatusDisabled = {
    status: "disabled";
};
```

```ts
export type McpStatusFailed = {
    status: "failed";
    error: string;
};
```

```ts
export type McpStatusNeedsAuth = {
    status: "needs_auth";
    error: string;
};
```

```ts
export type McpProtocol = "legacy" | "auto" | "2026-07-28";
```

---

## 10. The v2 client surface (`promise/client.d.ts`)

The whole surface is the return object of `make(options)`. Session-related methods, verbatim
from `node_modules/@opencode/client/dist/promise/client.d.ts`:

```ts
session: {
    list: (input?: SessionListInput, requestOptions?: RequestOptions) => Promise<SessionsResponse>;
    stats: (input?: SessionStatsInput, requestOptions?: RequestOptions) => Promise<SessionStatsInfo>;
    create: (input?: SessionCreateInput, requestOptions?: RequestOptions) => Promise<SessionInfo>;
    import: (input: SessionImportInput, requestOptions?: RequestOptions) => Promise<SessionInfo>;
    export: (input: SessionExportInput, requestOptions?: RequestOptions) => Promise<SessionTransferData>;
    active: (requestOptions?: RequestOptions) => Promise<{ [x: string]: SessionActive }>;
    get: (input: SessionGetInput, requestOptions?: RequestOptions) => Promise<SessionInfo>;
    remove: (input: SessionRemoveInput, requestOptions?: RequestOptions) => Promise<void>;
    fork: (input: SessionForkInput, requestOptions?: RequestOptions) => Promise<SessionInfo>;
    switchAgent: (input: SessionSwitchAgentInput, requestOptions?: RequestOptions) => Promise<void>;
    switchModel: (input: SessionSwitchModelInput, requestOptions?: RequestOptions) => Promise<void>;
    update: (input: SessionUpdateInput, requestOptions?: RequestOptions) => Promise<void>;
    move: (input: SessionMoveInput, requestOptions?: RequestOptions) => Promise<void>;
    prompt: (input: SessionPromptInput, requestOptions?: RequestOptions) => Promise<SessionInboxUser>;
    command: (input: SessionCommandInput, requestOptions?: RequestOptions) => Promise<void>;
    skill: (input: SessionSkillInput, requestOptions?: RequestOptions) => Promise<void>;
    synthetic: (input: SessionSyntheticInput, requestOptions?: RequestOptions) => Promise<SessionInboxSynthetic>;
    shell: (input: SessionShellInput, requestOptions?: RequestOptions) => Promise<void>;
    compact: (input: SessionCompactInput, requestOptions?: RequestOptions) => Promise<SessionInboxCompaction>;
    wait: (input: SessionWaitInput, requestOptions?: RequestOptions) => Promise<void>;
    revert: {
        stage: (input: SessionRevertStageInput, requestOptions?: RequestOptions) => Promise<SessionRevert>;
        clear: (input: SessionRevertClearInput, requestOptions?: RequestOptions) => Promise<void>;
        commit: (input: SessionRevertCommitInput, requestOptions?: RequestOptions) => Promise<void>;
    };
    context: (input: SessionContextInput, requestOptions?: RequestOptions) => Promise<SessionMessageInfo[]>;
    diff: (input: SessionDiffInput, requestOptions?: RequestOptions) => Promise<FileDiffInfo[]>;
    inbox: {
        list: (input: SessionInboxListInput, requestOptions?: RequestOptions) => Promise<SessionInboxInfo[]>;
        cancel: (input: SessionInboxCancelInput, requestOptions?: RequestOptions) => Promise<void>;
        update: (input: SessionInboxUpdateInput, requestOptions?: RequestOptions) => Promise<void>;
    };
    instructions: {
        entry: {
            list: (input: SessionInstructionsEntryListInput, requestOptions?: RequestOptions) => Promise<InstructionEntryInfo[]>;
            put: (input: SessionInstructionsEntryPutInput, requestOptions?: RequestOptions) => Promise<void>;
            remove: (input: SessionInstructionsEntryRemoveInput, requestOptions?: RequestOptions) => Promise<void>;
        };
    };
    generate: (input: SessionGenerateInput, requestOptions?: RequestOptions) => Promise<{ text: string }>;
    log: (input: SessionLogInput, requestOptions?: RequestOptions) => AsyncIterable<SessionLogOutput>;
    interrupt: (input: SessionInterruptInput, requestOptions?: RequestOptions) => Promise<SessionInterruptResponse>;
    background: (input: SessionBackgroundInput, requestOptions?: RequestOptions) => Promise<void>;
    message: {
        get: (input: SessionMessageGetInput, requestOptions?: RequestOptions) => Promise<SessionMessageInfo>;
    };
    form: {
        list: (input: SessionFormListInput, requestOptions?: RequestOptions) => Promise<FormInfo[]>;
        create: (input: SessionFormCreateInput, requestOptions?: RequestOptions) => Promise<FormInfo>;
        get: (input: SessionFormGetInput, requestOptions?: RequestOptions) => Promise<FormDetail>;
        reply: (input: SessionFormReplyInput, requestOptions?: RequestOptions) => Promise<void>;
        cancel: (input: SessionFormCancelInput, requestOptions?: RequestOptions) => Promise<void>;
    };
    environment: (input: SessionEnvironmentInput, requestOptions?: RequestOptions) => Promise<void>;
    view: (input: SessionViewInput, requestOptions?: RequestOptions) => Promise<void>;
};
```

Top-level (non-`session.*`) message and stream access:

```ts
message: {
    list: (input: MessageListInput, requestOptions?: RequestOptions) => Promise<SessionMessagesResponse>;
};
```

```ts
event: {
    subscribe(options?: SharedEvents.SubscribeOptions): AsyncIterable<V2Event>;
};
```

> **Important:** message listing lives at **`client.message.list(...)`**, *not*
> `client.session.messages(...)`. Within `session`, only `session.message.get(...)` exists.

### 10.1 `V2Event` — the full event union

```ts
export type V2Event =
    | LocationShutdown | ModelsDevRefreshed | CredentialUpdated | CredentialSwitched
    | IntegrationUpdated | ProviderUpdated | ModelUpdated | AgentUpdated
    | SessionCreated | SessionAgentSelected | SessionModelSelected | SessionMoved
    | SessionRenamed | SessionMetadataUpdated | SessionPermissions | SessionViewed
    | SessionUsageUpdated | SessionDeleted | SessionForked | SessionInboxDelivered
    | SessionInboxEnqueued | SessionInboxCancelled | SessionInboxDeliveryChanged
    | SessionExecutionStarted | SessionExecutionSucceeded | SessionExecutionFailed
    | SessionExecutionInterrupted | SessionInstructionsUpdated | SessionSynthetic
    | SessionSkillActivated | SessionShellStarted | SessionShellEnded
    | SessionStepStarted | SessionStepStreamed | SessionStepEnded | SessionStepFailed
    | SessionTextStarted | SessionTextDelta | SessionTextEnded
    | SessionReasoningStarted | SessionReasoningDelta | SessionReasoningEnded
    | SessionToolInputStarted | SessionToolInputDelta | SessionToolInputEnded
    | SessionToolCalled | SessionToolProgress | SessionToolSuccess | SessionToolFailed
    | SessionRetryScheduled | SessionCompactionStarted | SessionCompactionDelta
    | SessionCompactionEnded | SessionCompactionFailed | SessionRevertStaged
    | SessionRevertCleared | SessionRevertCommitted | FilesystemChanged | ReferenceUpdated
    | PermissionAsked | PermissionReplied | PluginUpdated | ProjectUpdated
    | WorktreeUpdated | WorktreeResolved | CommandUpdated | ConfigUpdated | SkillUpdated
    | PtyCreated | PtyUpdated | PtyExited | PtyDeleted | PersistentPtyAdded
    | PersistentPtyRemoved | ShellCreated | ShellExited | ShellDeleted
    | FormCreated | FormReplied | FormCancelled | WebsearchUpdated
    | SessionStatusUpdated | SessionIdle | TuiPromptAppend | TuiCommandExecute
    | TuiToastShow | TuiSessionSelect | InstallationUpdated | InstallationUpdateAvailable
    | VcsBranchUpdated | McpStatusChanged | McpResourcesChanged | V2EventRpc
    | V2EventServerConnected;
```

> `V2Event` includes **ephemeral** events (`SessionTextDelta`, `SessionReasoningDelta`,
> `SessionToolInputDelta`, `SessionToolProgress`, `SessionCompactionDelta`, `SessionIdle`,
> `SessionStatusUpdated`, `SessionUsageUpdated`, `PermissionAsked`/`Replied`, all form
> and PTY events). The **durable** subset is separately typed:

```ts
export type SessionEventDurable =
    | SessionCreated | SessionAgentSelected | SessionModelSelected | SessionMoved
    | SessionRenamed | SessionMetadataUpdated | SessionPermissions | SessionViewed
    | SessionDeleted | SessionForked | SessionInboxDelivered | SessionInboxEnqueued
    | SessionInboxCancelled | SessionInboxDeliveryChanged | SessionExecutionStarted
    | SessionExecutionSucceeded | SessionExecutionFailed | SessionExecutionInterrupted
    | SessionInstructionsUpdated | SessionSynthetic | SessionSkillActivated
    | SessionShellStarted | SessionShellEnded | SessionStepStarted | SessionStepStreamed
    | SessionStepEnded | SessionStepFailed | SessionTextStarted | SessionTextEnded
    | SessionReasoningStarted | SessionReasoningEnded | SessionToolInputStarted
    | SessionToolInputEnded | SessionToolCalled | SessionToolSuccess | SessionToolFailed
    | SessionRetryScheduled | SessionCompactionStarted | SessionCompactionEnded
    | SessionCompactionFailed | SessionRevertStaged | SessionRevertCleared
    | SessionRevertCommitted | SessionUsageRecorded | SessionMessageContentUpdated;
```

```ts
export type SessionLogItem = SessionEventDurable | EventLogSynced;
```

`session.log()` returns `AsyncIterable<SessionLogItem>` — durable replay only.

Two non-session-delta members of `V2Event` are worth noting because they do **not** follow
the standard envelope:

```ts
export type V2EventRpc = {
    id: string;
    created: number;
    metadata?: {
        [x: string]: any;
    } | undefined;
    type: `${"rpc."}${string}`;
    location: LocationPublicRef;
    data: {
        [x: string]: any;
    };
};
```

```ts
export type V2EventServerConnected = {
    id: string;
    metadata?: {
        [x: string]: any;
    } | undefined;
    location?: LocationPublicRef | undefined;
    type: "server.connected";
    data: {};
};
```

`V2EventServerConnected` has **no `created`** field and uses `LocationPublicRef`.

---

## 11. v1 → v2 session method mapping

The v1 surface was verified against the actual v1 SDK at
`node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts`, `declare class Session`:

```ts
list, create, status, delete, get, update, children, todo, init, fork, abort,
unshare, share, diff, summarize, messages, prompt, message, promptAsync,
command, shell, revert, unrevert
```

The v2 surface is the `session` object quoted in §10. The complete mapping:

| v1 method | v2 equivalent | Notes |
| --- | --- | --- |
| `session.list()` | ✅ `session.list()` | Returns `SessionsResponse` (`{ data, cursor }`) instead of a bare array. |
| `session.create()` | ✅ `session.create()` | Returns `SessionInfo`. |
| `session.status()` | ⚠️ **renamed** → `session.active()` | `active()` returns `{ [x: string]: SessionActive }` keyed by session id, i.e. **all sessions at once**, not one. Live per-session updates arrive via the `SessionStatusUpdated` / `"session.status"` event and the `SessionIdle` event. |
| `session.delete(id)` | ⚠️ **renamed** → `session.remove({ sessionID })` | No `delete` key on v2. **False friend:** JS `delete` is a reserved word, which is likely why it was renamed. |
| `session.get(id)` | ✅ `session.get({ sessionID })` | |
| `session.update()` | ✅ `session.update()` | |
| `session.children(id)` | ❌ **no direct equivalent** → `session.list({ parentID })` | `SessionListInput` has `parentID?: string \| null`. |
| `session.todo(id)` | ❌ **NO v2 EQUIVALENT AT ALL** | The string `todo` does not appear anywhere in `@opencode/client/dist` (case-insensitive search over every file returns nothing). There is no todo type, no todo method, no todo event. Todo functionality was removed, not renamed. |
| `session.init()` | ❌ no equivalent | Not present in v2. |
| `session.fork()` | ✅ `session.fork()` | v2 adds an explicit `SessionForkBoundary` (`"before"` / `"through"`) instead of a bare `messageID`. |
| `session.abort()` | ⚠️ **renamed** → `session.interrupt()` | Returns `SessionInterruptResponse` = `{ interrupted: boolean }`. `SessionInterruptInput` also accepts `resume?: boolean`. |
| `session.unshare()` | ❌ no equivalent | No `unshare` anywhere in v2. |
| `session.share()` | ❌ **no method** → replaced by `session.export()` | `share` survives only as a **config value** `share?: "manual" \| "auto" \| "disabled"` and as a TUI command literal `"session.share"`. The API-level replacement is `session.export({ sessionID, sanitize? })` → `SessionTransferData`. There is no "unshare"; importing is the inverse. |
| `session.diff()` | ✅ `session.diff()` | v2 returns `FileDiffInfo[]` directly (v1 returned a v1 `Diff`). |
| `session.summarize()` | ⚠️ **renamed** → `session.compact()` | `SessionCompactInput = { sessionID, id?, delivery? }`, returns `SessionInboxCompaction`. |
| `session.messages(id)` | ❌ **moved** → `client.message.list({ sessionID, ... })` | Not under `session` at all. Returns `SessionMessagesResponse` (`{ data, cursor }`) with cursor pagination, not a bare array. There is no `session.messages`. |
| `session.prompt()` | ✅ `session.prompt()` | Returns `SessionInboxUser` (the enqueued item), **not** an assistant response. `SessionPromptInput` gained `delivery`, `resume`, and `id`. |
| `session.message()` | ✅ `session.message.get()` | Now nested one level deeper. |
| `session.promptAsync()` | ❌ no equivalent | v2 `session.prompt()` is already async/enqueueing, so `promptAsync` is subsumed. |
| `session.command()` | ✅ `session.command()` | |
| `session.shell()` | ✅ `session.shell()` | |
| `session.revert()` | ⚠️ **split into 3** → `session.revert.stage()` / `.clear()` / `.commit()` | `stage` returns `SessionRevert`; `clear` and `commit` return `void`. |
| `session.unrevert()` | ⚠️ **renamed** → `session.revert.clear()` | "Unrevert" = discard the staged revert. |

### 11.1 v1 methods with NO v2 replacement

- **`session.todo()`** — fully removed. No todo type, method, or event exists in v2.
- **`session.init()`** — removed.
- **`session.unshare()`** — removed.
- **`session.promptAsync()`** — subsumed by `session.prompt()`.

### 11.2 v1 methods that exist but with a different name or location

| v1 | v2 | Kind of change |
| --- | --- | --- |
| `abort` | `interrupt` | rename |
| `children` | `list({ parentID })` | fold into `list` |
| `delete` | `remove` | rename (reserved word) |
| `status` | `active` (+ `SessionStatusUpdated` event) | rename + reshape |
| `share` | `export` | rename + reshape |
| `summarize` | `compact` | rename |
| `unrevert` | `revert.clear` | rename + nest |
| `messages` | `client.message.list` | moved off `session`, gained pagination |
| `message` | `message.get` | nested one level deeper |
| `revert` | `revert.stage` | nested one level deeper |

### 11.3 v2 session methods with no v1 counterpart

`stats`, `import`, `export`, `active`, `switchAgent`, `switchModel`, `move`, `skill`,
`synthetic`, `shell` (as a session method), `compact`, `wait`, `revert.*`, `context`,
`interrupt`, `background`, `environment`, `view`, `generate`, `log`, `inbox.*`,
`instructions.entry.*`, `form.*`.

The `session.inbox.*`, `session.instructions.entry.*`, `session.form.*` and
`session.context()`, `session.log()`, `session.interrupt()`, `session.background()`,
`session.wait()` families are entirely new in v2 and are the primary way to drive a
session.

---

## 12. Summary of the definitive answers

**Message/part streaming shape.** A v2 assistant message is **not** a `parts` array and
**not** a `blocks` array. It is a single `SessionMessageAssistant` whose content lives in a
field named **`content`**, typed
`Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>`
— a discriminated union over `type` with exactly the three variants `"text"`, `"reasoning"`,
`"tool"`. Tool parts nest a further union `state` discriminated by `state.status` over
`"streaming" | "running" | "completed" | "error"`.

**How it streams.** Both mechanisms exist, on separate channels:

- **Incremental events** carry the live token stream: `SessionTextStarted` →
  `SessionTextDelta`* → `SessionTextEnded`; `SessionReasoningStarted` →
  `SessionReasoningDelta`* → `SessionReasoningEnded`; `SessionToolInputStarted` →
  `SessionToolInputDelta`* → `SessionToolInputEnded` → `SessionToolCalled` →
  `SessionToolProgress`* → `SessionToolSuccess` | `SessionToolFailed`. The `*Delta` events
  and `SessionToolProgress` are **ephemeral** (no `durable` block). Correlate text/reasoning
  deltas by `data.ordinal`, tool events by `data.id`.
- **Snapshot replacement** arrives via the durable `SessionMessageContentUpdated`
  (`"session.message.content.updated"`), whose `data.content` is a full fresh
  `Array<SessionMessageAssistantContentEncoded>` — the same three-variant union with
  `any`-valued provider state.

There is no v2 `PartDelta` type; that existed only in v1
(`@opencode/schema/dist/v1/session.d.ts` exports `PartDelta`).

**Types that do NOT exist under the requested names.** Stated explicitly rather than
guessed:

| Requested name | Reality |
| --- | --- |
| `PtyInfo` | **Not found.** The PTY value type is `Pty`. (`PersistentPtyInfo` exists but is the experimental persistent-PTY type.) |
| `McpStatus` | **Not found.** The union is written inline on `McpServer.status`; the five member types are `McpStatusConnected`, `McpStatusPending`, `McpStatusDisabled`, `McpStatusFailed`, `McpStatusNeedsAuth`. |
| `PartDelta`, `Part`, `TextPart`, `ReasoningPart`, `ToolPart` | **Not in v2.** These are v1 names (`@opencode/schema/dist/v1/session.d.ts`). v2 equivalents: `SessionMessageAssistantText`, `SessionMessageAssistantReasoning`, `SessionMessageAssistantTool`. |
| `SessionMessageAssistant.parts` / `.blocks` | **Neither field exists.** The field is `content`. |

Everything else requested was found and is documented above.

