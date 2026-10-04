# UI ↔ API Field-Usage Audit (OpenCode v1 → v2)

**Purpose:** enumerate every field the UI/rest-of-codebase **reads** from the API type layer, so a
projection layer can keep the UI (and `src/types/message.ts`) unchanged.

**Audited revision:** working tree at `dev` (HEAD `dc617b96`) with an in-progress v2 rewrite.
`package.json` version `0.6.46`; installed `@opencode-ai/sdk` `1.16.0`, `@opencode/client` `2.0.21`.

Type layers in scope:

| Layer | Path | Fate |
| --- | --- | --- |
| API types | `src/types/api/**`, `src/api/types.ts` | **rewritten / replaced** in v2 |
| API functions | `src/api/**` | rewritten |
| UI view model | `src/types/message.ts` | **KEPT unchanged** |

---

## 0. Method, and two critical caveats

### Method

Every field name was searched as `\.fieldName\b` across all `*.ts`/`*.tsx` under `src/`, then each hit
was classified by hand as a **read**, a **type definition**, a **re-export**, or a **false positive**.
Counts are split **production / test**. Searches run with `Select-String` (no `rg` on this machine).

**Excluded from read counts:** `src/types/api/index.ts` (pure re-exports) and files under
`src/types/api/` when the hit is a type declaration. Where a declaration in `src/types/api/*.ts`
diverges from true v2, it is reported separately — that divergence *is* a projection requirement.

### Caveat A — the tree is mid-migration; `src/types/api/*` is being rewritten concurrently

At audit time `src/api/sdk.ts` had already been switched from `@opencode-ai/sdk/v2/client` to the real
v2 client `@opencode/client/promise` (`OpenCode.make`), while all 15 `src/types/api/*.ts` files were in
the middle of a parallel rewrite. Two different "v2" surfaces are therefore in play:

| Surface | Version | v2 fidelity |
| --- | --- | --- |
| `@opencode/client/promise` (`src/api/sdk.ts`) | 2.0.21 | **authoritative v2** — matches `docs-v2-types.md` |
| `@opencode-ai/sdk/v2/client` (imported by `src/types/api/*` at audit start) | 1.16.0 | **stale** — still carries `share`, `summary`, `version`, `Todo`, `question.*`, `session.todo()` |

The v2 status column below is judged against **`@opencode/client` 2.0.21** (= `docs-v2-types.md`).
Where the stale surface differs materially, it is flagged, because a projection built against the
wrong surface will silently keep v1 fields alive. Representative divergences:

* `PermissionRequest` — authoritative v2 (`docs-v2-types.md` §4.1, `@opencode/client`): `{id, sessionID, action, resources, save?, metadata?, source?, message?}`. Stale `@opencode-ai/sdk/v2`: `{id, sessionID, permission, patterns, metadata, always, tool?}`.
* `Session` — authoritative v2 `SessionInfo`: no `share`/`summary`/`directory`/`version`/`path`. Stale surface still exposes all five.
* `Todo` / `question.*` — **absent** from `@opencode/client` (0 case-insensitive hits for `todo` in the whole `dist/`); still present in the stale surface.

> **Verified:** the string `todo` does not occur anywhere under `node_modules/@opencode/client/dist`.
> This independently confirms `docs-v2-types.md`: todo was removed, not renamed.

### Caveat B — the UI layer has not been touched yet

`git diff --stat` shows only `package.json`, `package-lock.json`, `src/api/sdk.ts` and
`src/types/api/*` modified. **Every UI file is still written against the v1 shape.** That is exactly
why this inventory is meaningful: the read-sites below are the real v1 contract the projection must satisfy.

At audit time `npx tsc --noEmit -p tsconfig.app.json` reports **239 errors**, 154 of them inside
`src/types/api/*` + `src/api/*`. The 85 in UI files are the mechanical consequence of the rewrite
having landed in the type layer but not the consumer layer; they are itemised in
[§10](#10-current-typecheck-breakage-ui-side).

---

## 1. `ApiSession` (a.k.a. `Session`)

`src/types/api/session.ts` → `export type Session = SDKSession` (v2-native alias while migrating).

### 1.1 Field read table

| Field | Read count (prod/test) | Example locations | v2 status |
| --- | --- | --- | --- |
| `.id` | 85 / 14 | [SidePanel.tsx:983](src/features/chat/sidebar/SidePanel.tsx#L983) `updateSession(session.id, …)`, [SessionContext.tsx:129](src/contexts/SessionContext.tsx#L129) | **exists** |
| `.directory` | **123 / 0** | [SessionList.tsx:476](src/features/sessions/SessionList.tsx#L476), [useSessions.ts:109](src/hooks/useSessions.ts#L109), [SessionContext.tsx:80-81](src/contexts/SessionContext.tsx#L80-L81), [useSessionManager.ts:165](src/hooks/useSessionManager.ts#L165), [MultiServerFolderList.tsx:257](src/features/chat/sidebar/MultiServerFolderList.tsx#L257), [useChatSession.ts:687](src/hooks/useChatSession.ts#L687) | **RENAMED → `location.directory`** |
| `.title` | 22 / 0 | [SidePanel.tsx:983](src/features/chat/sidebar/SidePanel.tsx#L983), [useSessionManager.ts:166](src/hooks/useSessionManager.ts#L166), [useGlobalEvents.ts:558](src/hooks/useGlobalEvents.ts#L558) | exists (`title?: string`, now optional) |
| `.parentID` | 16 / 0 | [childSessionStore.ts:65](src/store/childSessionStore.ts#L65), [childSessionStore.ts:68](src/store/childSessionStore.ts#L68), [SessionContext.tsx:157](src/contexts/SessionContext.tsx#L157), [useSessions.ts:245](src/hooks/useSessions.ts#L245), [useGlobalEvents.ts:543](src/hooks/useGlobalEvents.ts#L543) | **exists** |
| `.time.updated` | 5 / 0 | [SessionList.tsx:135](src/features/sessions/SessionList.tsx#L135), [SessionList.tsx:714](src/features/sessions/SessionList.tsx#L714), [SessionList.tsx:842](src/features/sessions/SessionList.tsx#L842) | **exists** |
| `.time.created` | 6 / 0 | [childSessionStore.ts:85](src/store/childSessionStore.ts#L85), [SessionList.tsx:135](src/features/sessions/SessionList.tsx#L135) | **exists** |
| `.revert` | 8 / 0 | [api/session.ts:77](src/api/session.ts#L77) `session.revert?.messageID`, [useRevertState.ts:110](src/hooks/useRevertState.ts#L110), [:172-173](src/hooks/useRevertState.ts#L172-L173), [useSessionManager.ts:223](src/hooks/useSessionManager.ts#L223) | **exists** — only `.messageID` is read; v2 `SessionRevert` keeps `messageID` (adds `files`) |
| `.summary` | **15 / 0** | [SessionList.tsx:441-442](src/features/sessions/SessionList.tsx#L441-L442), [:698](src/features/sessions/SessionList.tsx#L698), [:702-710](src/features/sessions/SessionList.tsx#L702-L710), [:844-852](src/features/sessions/SessionList.tsx#L844-L852) | **REMOVED** — `SessionInfo` has no `summary` |
| `.share` | **7 / 0** | [ShareDialog.tsx:34](src/features/chat/ShareDialog.tsx#L34) `updatedSession.share?.url`, [useSessionManager.ts:167](src/hooks/useSessionManager.ts#L167), [:209](src/hooks/useSessionManager.ts#L209), [:224](src/hooks/useSessionManager.ts#L224) | **REMOVED** — no `share` on `SessionInfo` (v2 `session.export()` replaces it) |
| `.agent` | 1 / 0 | [childSessionStore.ts:83](src/store/childSessionStore.ts#L83) `agent: session.agent` | **exists** (`agent?: string`) |
| `.version` | **0 / 0** | — (6 `session.version`-looking hits are unrelated store counters: [childSessionStore.ts:52](src/store/childSessionStore.ts#L52), [todoStore.ts:68](src/store/todoStore.ts#L68)) | REMOVED — **not read, no action needed** |
| `.path` | **0 / 0** | — | REMOVED — not read |
| `.projectID` | **0 / 0** | — (4 hits are a local `projectId` field on dialogs) | exists — not read |
| `.cost` / `.tokens` (session-level) | **0 / 0** | — | v2 **added** `cost`/`tokens` to `SessionInfo`; not read |
| `.outcome` / `.slug` / `.subpath` / `.workspaceID` / `.permissions` / `.metadata` / `.fork` | **0 / 0** | — | v2 additions, not read |

### 1.2 Direct answers to the critical questions

| Question | Answer | Consequence |
| --- | --- | --- |
| Is `.directory` read? | **YES — 123 production reads, the single most-read session field.** | **Hard blocker.** Projection MUST materialise `directory` from `location.directory`. |
| Is `.share` read? | **YES — 7 reads**, all `.share?.url`. | **Blocker.** v2 has no session `share`. Must project `{url}` (from `session.export()`) or stub to `undefined` and degrade the Share dialog. |
| Is `.summary` read? | **YES — 15 reads**, `.additions`/`.deletions`/`.files` on the session row. | **Blocker.** v2 has no session-level `summary`. Must derive (e.g. from `session.diff()`) or drop the stats. |
| Is `.revert` read? | **YES — 8 reads**, only `.messageID`. | **Not a blocker.** v2 `SessionRevert` keeps `messageID`. |
| Is `.path` read? | **NO — 0 reads.** | Nothing to do. |
| Is `.version` read? | **NO — 0 reads.** | Nothing to do. |

### 1.3 Session list params also change

`SessionListParams` is consumed at [api/session.ts:94-104](src/api/session.ts#L94-L104) and callers pass
`roots`:

* [SessionContext.tsx:70](src/contexts/SessionContext.tsx#L70) `roots: true`
* [SearchResults.tsx:121](src/features/chat/sidebar/SearchResults.tsx#L121) `getSessions({ search, roots: false, limit: 50 }, serverId)`
* [useSessions.ts:138](src/hooks/useSessions.ts#L138) `roots: rootsOnly`

v2 `SessionListInput` has **no `roots`**; `session.children(id)` also no longer exists — both fold into
`session.list({ parentID })`. See [§9](#9-v1-method-names-called-as-api).

---

## 2. `ApiMessageWithParts` / `Message` — the `{info, parts}` envelope

```ts
// src/types/api/message.ts (at audit start)
export interface MessageWithParts { info: Message; parts: Part[] }
```

### 2.1 Read table

| Field | Read count (prod/test) | Example locations | v2 status |
| --- | --- | --- | --- |
| `.info` | **227 / 30** | [ChatArea.tsx:236](src/features/chat/ChatArea.tsx#L236), [chatPageModel.ts:683](src/features/chat/chatPageModel.ts#L683), [messageStore.ts:374](src/store/messageStore.ts#L374), [MessageRenderer.tsx:140](src/features/message/MessageRenderer.tsx#L140), [ContextDetailsDialog.tsx:61](src/features/chat/sidebar/ContextDetailsDialog.tsx#L61) | **STRUCTURE REMOVED** — v2 messages carry their own content |
| `.parts` | **45 / 20** | [chatAreaVisibility.ts:28-30](src/features/chat/chatAreaVisibility.ts#L28-L30), [MessageRenderer.tsx:268](src/features/message/MessageRenderer.tsx#L268), [messageStore.ts:195](src/store/messageStore.ts#L195), [sessionStatsCompute.ts:48](src/hooks/sessionStatsCompute.ts#L48), [outlineIndexModel.ts:24](src/components/outlineIndexModel.ts#L24) | **FIELD REMOVED** — v2 uses `content: Array<text\|reasoning\|tool>` on **assistant only**; user/system/synthetic carry `text`/`files`/`agents` directly |
| `.message` (v1 fallback) | **1 / 0** | [messageConversion.ts:8](src/utils/messageConversion.ts#L8) `'info' in apiMessage ? apiMessage.info : apiMessage.message` | legacy tolerance — the **only** place the alternate key is read |

### 2.2 Verdict

`{info, parts}` is read **pervasively (272 sites)** and is read **uniformly through `.info`/`.parts`**.
The only `.message` reader is the deliberate fallback in
[messageConversion.ts:5-9](src/utils/messageConversion.ts#L5-L9), which already accepts either key:

```ts
type ApiMessageEnvelope = ApiMessageWithParts | { message: ApiMessageWithParts['info']; parts: ApiMessageWithParts['parts'] }
function getEnvelopeInfo(apiMessage: ApiMessageEnvelope) { return 'info' in apiMessage ? apiMessage.info : apiMessage.message }
```

**This file is the natural projection seam.** If the projection emits `{info, parts}` with a v1-shaped
`info` and v1-shaped `parts`, the 272 read-sites need no change. The work is entirely in synthesising
`parts` — see [§4.4](#44-part-types-that-do-not-exist-in-v2).

---

## 3. `ApiMessage` / message info

`Message = UserMessage | AssistantMessage`. v1 `info` shape is mirrored by `src/types/message.ts`
`UserMessageInfo` / `AssistantMessageInfo` (KEPT).

### 3.1 Field read table

| Field | Read count (prod/test) | Example locations | v2 status |
| --- | --- | --- | --- |
| `.id` | 102 / 18 | [ChatArea.tsx:140](src/features/chat/ChatArea.tsx#L140), [OutlineIndex.tsx:374-375](src/components/OutlineIndex.tsx#L374-L375), [messageStore.ts:375](src/store/messageStore.ts#L375) | **exists** (all v2 message variants have `id`) |
| `.role` | 58 / 2 | [outlineIndexModel.ts:21](src/components/outlineIndexModel.ts#L21), [ChatArea.tsx:141](src/features/chat/ChatArea.tsx#L141), [messageStore.ts:564](src/store/messageStore.ts#L564), [chatAreaUtils.ts:11](src/features/chat/chatAreaUtils.ts#L11) | **RENAMED → `type`** (`'user'`/`'assistant'`/`'system'`/`'synthetic'`/`'skill'`/`'shell'`/`'idle'`/`'compaction'`/…) |
| `.time.created` | 9 / 0 | [chatPageModel.ts:683](src/features/chat/chatPageModel.ts#L683), [MessageRenderer.tsx:592](src/features/message/MessageRenderer.tsx#L592), [messageStore.ts:381](src/store/messageStore.ts#L381) | **exists** |
| `.time.completed` | 9 / 0 | [chatPageModel.ts:694-695](src/features/chat/chatPageModel.ts#L694-L695), [:821](src/features/chat/chatPageModel.ts#L821), [:937](src/features/chat/chatPageModel.ts#L937), [messageStore.ts:55](src/store/messageStore.ts#L55), [:664](src/store/messageStore.ts#L664) | **exists on assistant** (`time.completed?`); **absent on user** — `messageStore.ts:55` already guards with `'completed' in info.time` |
| `.summary` | 3 / 0 | [outlineIndexModel.ts:37](src/components/outlineIndexModel.ts#L37) `msg.info.summary?.title`, [useChatPageViewModel.ts:43](src/features/chat/useChatPageViewModel.ts#L43), [api/session.ts:82](src/api/session.ts#L82) `info.summary?.diffs` | **SHAPE CHANGED** — v1 user `summary = {title?, body?, diffs}`; v2 user `summary = {title?, body?, diffs: SnapshotFileDiff[]}` (diffs now required, diff objects differ). Assistant `summary` is v1-only: v2 has no assistant `summary` (use `compaction` messages). |
| `.modelID` / `.providerID` | 4 / 0 | [MessageRenderer.tsx:797](src/features/message/MessageRenderer.tsx#L797) `assistantInfo?.modelID`, [ContextDetailsDialog.tsx:102](src/features/chat/sidebar/ContextDetailsDialog.tsx#L102), [:106](src/features/chat/sidebar/ContextDetailsDialog.tsx#L106) | **RESTRUCTURED** — v2 assistant carries `model: ModelRef = {id, providerID, variant?}`. Flat `modelID`/`providerID` must be projected (`modelID ← model.id`) |
| `.model` | 2 / 0 (via `userInfo.model`) + 3 store reads | [ChatPane.tsx:503](src/features/chat/ChatPane.tsx#L503) `userInfo.model?.variant`, [useChatSession.ts:959-960](src/hooks/useChatSession.ts#L959-L960), [messageStore.ts:473-474](src/store/messageStore.ts#L473-L474) | v2 user `model: ModelRef` (`id`, not `modelID`) — see [§4.5](#45-modelref-modelid-vs-id) |
| `.agent` | 1 / 0 | [messageStore.ts:475](src/store/messageStore.ts#L475) `agent: m.info.agent` | **exists** on v2 user + assistant (`agent: string`) |
| `.cost` / `.tokens` | 4 / 0 | [ContextDetailsDialog.tsx:61](src/features/chat/sidebar/ContextDetailsDialog.tsx#L61), [:155-156](src/features/chat/sidebar/ContextDetailsDialog.tsx#L155-L156), [sessionStatsCompute.ts:112-113](src/hooks/sessionStatsCompute.ts#L112-L113) | **exists on assistant** (`cost?: number`, `tokens?: TokenUsageInfo`). `tokens` shape **changed**: v1 `{input,output,reasoning,cache{read,write}}`; v2 `TokenUsageInfo` is the same 4 keys → compatible. |
| `.error` | 2 / 0 | [outlineIndexModel.ts:21](src/components/outlineIndexModel.ts#L21), [messageStore.ts](src/store/messageStore.ts) via `isAbortedMessage` | **SHAPE CHANGED** — v1 `error` is a tagged union (`{name:'APIError', data:{message,statusCode,isRetryable,…}}`); v2 `error?: SessionStructuredError = {type, message, status?, response?}`. See [§3.3](#33-error-shape). |
| `.sessionID` | 2 / 0 | [messageStore.ts:374](src/store/messageStore.ts#L374) `this.ensureSession(message.info.sessionID)`, [:387](src/store/messageStore.ts#L387) | **ABSENT on v2 message variants** — v2 messages carry `id` but `sessionID` lives on the response/event envelope (`data.sessionID`), not on the message. Must be injected. |
| `.parentID` | **0 / 0** | — | v1-only, unread |
| `.mode` | **0 / 0** | — | v1-only, unread |

### 3.2 Direct answers

| Field | Read? | v2 |
| --- | --- | --- |
| `.role` | **YES (58)** | → `type` |
| `.id` | **YES (102)** | exists |
| `.sessionID` | **YES (2)** | removed from the message; inject from envelope |
| `.parentID` | **NO (0)** | unread |
| `.time.completed` | **YES (9)** | exists on assistant |
| `.summary` | **YES (3)** | user only, shape changed |
| `.error` | **YES (2)** | shape changed |
| `.modelID` | **YES (1)** | → `model.id` |
| `.providerID` | **YES (1)** | → `model.providerID` |
| `.mode` | **NO (0)** | unread |
| `.agent` | **YES (1)** | exists |
| `.path` | **NO (0)** | unread |
| `.cost` | **YES (1)** | exists |
| `.tokens` | **YES (3)** | exists |
| `.finish` | **NO (0)** | unread |

### 3.3 Error shape

`MessageErrorView.tsx` and `SystemPartViews.tsx` read `error.data.{message,isRetryable,statusCode,providerID}`:

* [MessageErrorView.tsx:91](src/features/message/parts/MessageErrorView.tsx#L91), [:105](src/features/message/parts/MessageErrorView.tsx#L105), [:111-116](src/features/message/parts/MessageErrorView.tsx#L111-L116), [:123](src/features/message/parts/MessageErrorView.tsx#L123)
* [SystemPartViews.tsx:25](src/features/message/parts/SystemPartViews.tsx#L25) `error.data.isRetryable`, [:53](src/features/message/parts/SystemPartViews.tsx#L53) `error.data.message`, [:55-57](src/features/message/parts/SystemPartViews.tsx#L55-L57) `error.data.statusCode`

v1 `APIError` is **preserved verbatim in the stale v2 surface** (`@opencode-ai/sdk/v2` `ApiError = {name:"APIError", data:{message, statusCode?, isRetryable, responseHeaders?, responseBody?, metadata?}}`) but the **authoritative v2 `@opencode/client` has no `ApiError` at all** — it has `SessionStructuredError = {type, message, status?, response?}`. `isRetryable` and `statusCode` therefore have no source. See blockers.

---

## 4. `ApiPart` — the part union

`Part` is a 12-member union discriminated by `type`:
`text | reasoning | tool | file | agent | step-start | step-finish | snapshot | patch | subtask | retry | compaction`.

### 4.1 `part.type` values switched/checked (production)

| `type` | Checks (prod) | Dispatch sites |
| --- | --- | --- |
| `text` | 20 | [MessageRenderer.tsx:872](src/features/message/MessageRenderer.tsx#L872), [:595](src/features/message/MessageRenderer.tsx#L595), [:1430](src/features/message/MessageRenderer.tsx#L1430), [chatPageModel.ts:93](src/features/chat/chatPageModel.ts#L93), [chatAreaVisibility.ts:34](src/features/chat/chatAreaVisibility.ts#L34), [sessionStatsCompute.ts:11](src/hooks/sessionStatsCompute.ts#L11), [types/index.ts:54](src/types/index.ts#L54) |
| `reasoning` | 6 | [MessageRenderer.tsx:874](src/features/message/MessageRenderer.tsx#L874), [chatPageModel.ts:96](src/features/chat/chatPageModel.ts#L96), [chatAreaVisibility.ts:33](src/features/chat/chatAreaVisibility.ts#L33), [sessionStatsCompute.ts:21](src/hooks/sessionStatsCompute.ts#L21) |
| `tool` | 8 | [chatPageModel.ts:99](src/features/chat/chatPageModel.ts#L99), [:823](src/features/chat/chatPageModel.ts#L823), [chatAreaVisibility.ts:35](src/features/chat/chatAreaVisibility.ts#L35), [types/message.ts:328](src/types/message.ts#L328) |
| `file` | 7 | [MessageRenderer.tsx:597](src/features/message/MessageRenderer.tsx#L597), [chatPageModel.ts:104](src/features/chat/chatPageModel.ts#L104), [messageStore.ts:811](src/store/messageStore.ts#L811), [useInputHistory.ts:52](src/features/chat/input/useInputHistory.ts#L52) |
| `agent` | 11 | [MessageRenderer.tsx:598](src/features/message/MessageRenderer.tsx#L598), [chatPageModel.ts:114](src/features/chat/chatPageModel.ts#L114), [messageStore.ts:835](src/store/messageStore.ts#L835) |
| `step-finish` | 11 | [MessageRenderer.tsx:884](src/features/message/MessageRenderer.tsx#L884), [:799](src/features/message/MessageRenderer.tsx#L799), [:201-245](src/features/message/MessageRenderer.tsx#L201-L245), [chatPageModel.ts:110](src/features/chat/chatPageModel.ts#L110) |
| `step-start` | 5 | **never rendered** — only filtered: [chatAreaVisibility.ts:31](src/features/chat/chatAreaVisibility.ts#L31), [MessageRenderer.tsx:1428](src/features/message/MessageRenderer.tsx#L1428), [:1453](src/features/message/MessageRenderer.tsx#L1453) |
| `snapshot` | 5 | **never rendered** — only filtered (same sites as `step-start`) |
| `patch` | 5 | **rendered nowhere.** `PatchPartView` defined at [SystemPartViews.tsx:96](src/features/message/parts/SystemPartViews.tsx#L96) and exported at [parts/index.ts:7](src/features/message/parts/index.ts#L7), but **no `case 'patch'`** in the MessageRenderer switch and no other importer except its own test → effectively dead code |
| `subtask` | 3 | [MessageRenderer.tsx:898](src/features/message/MessageRenderer.tsx#L898), [chatPageModel.ts:107](src/features/chat/chatPageModel.ts#L107), [chatAreaVisibility.ts:47](src/features/chat/chatAreaVisibility.ts#L47) |
| `retry` | 11 | [MessageRenderer.tsx:900](src/features/message/MessageRenderer.tsx#L900) → [SystemPartViews.tsx:17](src/features/message/parts/SystemPartViews.tsx#L17) |
| `compaction` | 5 | [MessageRenderer.tsx:902](src/features/message/MessageRenderer.tsx#L902) → [SystemPartViews.tsx:75](src/features/message/parts/SystemPartViews.tsx#L75) |

**Primary dispatch switch:** [MessageRenderer.tsx:871-906](src/features/message/MessageRenderer.tsx#L871-L906)
— handles `text`, `reasoning`, `step-finish`, `subtask`, `retry`, `compaction`; **`default: return null`**.
A parallel dispatch exists at [MessageRenderer.tsx:1428-1460](src/features/message/MessageRenderer.tsx#L1428-L1460)
and a third at [chatPageModel.ts:91-116](src/features/chat/chatPageModel.ts#L91-L116) (weight estimation).

### 4.2 Per-variant field reads

| Variant | Field | Count | Example |
| --- | --- | --- | --- |
| **text** | `.text` | many | [TextPartView.tsx:14](src/features/message/parts/TextPartView.tsx#L14), [MessageRenderer.tsx:595](src/features/message/MessageRenderer.tsx#L595), [sessionStatsCompute.ts:11](src/hooks/sessionStatsCompute.ts#L11) |
| | `.synthetic` | 11 | [TextPartView.tsx:20](src/features/message/parts/TextPartView.tsx#L20), [MessageRenderer.tsx:596](src/features/message/MessageRenderer.tsx#L596), [chatPageModel.ts:94](src/features/chat/chatPageModel.ts#L94), [messageStore.ts:802](src/store/messageStore.ts#L802) |
| | `.time.start` / `.time.end` | via | [ReasoningPartView.tsx:26](src/features/message/parts/ReasoningPartView.tsx#L26), [:48-49](src/features/message/parts/ReasoningPartView.tsx#L48-L49) |
| **reasoning** | `.text` | ✓ | [ReasoningPartView.tsx:24](src/features/message/parts/ReasoningPartView.tsx#L24), [sessionStatsCompute.ts:21](src/hooks/sessionStatsCompute.ts#L21) |
| | `.time.start` / `.time.end` | ✓ | [ReasoningPartView.tsx:26](src/features/message/parts/ReasoningPartView.tsx#L26), [:48-49](src/features/message/parts/ReasoningPartView.tsx#L48-L49), [:55](src/features/message/parts/ReasoningPartView.tsx#L55) |
| **tool** | `.callID` | 7 | [ToolPartView.tsx:82](src/features/message/parts/ToolPartView.tsx#L82), [:85](src/features/message/parts/ToolPartView.tsx#L85), [BashRenderer.tsx:35](src/features/message/tools/renderers/BashRenderer.tsx#L35), [MessageRenderer.tsx:977-978](src/features/message/MessageRenderer.tsx#L977-L978) |
| | `.tool` | 11 | [registry.tsx:361](src/features/message/tools/registry.tsx#L361), [ToolPartView.tsx:556](src/features/message/parts/ToolPartView.tsx#L556), [MessageRenderer.tsx:1242](src/features/message/MessageRenderer.tsx#L1242), [:1373](src/features/message/MessageRenderer.tsx#L1373), [sessionStatsCompute.ts:56](src/hooks/sessionStatsCompute.ts#L56) |
| | `.state.status` | 24+ | [ToolPartView.tsx:61](src/features/message/parts/ToolPartView.tsx#L61), [ToolPartView.tsx](src/features/message/parts/ToolPartView.tsx#L474), [BashRenderer.tsx:28](src/features/message/tools/renderers/BashRenderer.tsx#L28), [DefaultRenderer.tsx:20](src/features/message/tools/renderers/DefaultRenderer.tsx#L20), [TaskRenderer.tsx:37](src/features/message/tools/renderers/TaskRenderer.tsx#L37), [MessageRenderer.tsx:994](src/features/message/MessageRenderer.tsx#L994), [:1249-1250](src/features/message/MessageRenderer.tsx#L1249-L1250), [:1368](src/features/message/MessageRenderer.tsx#L1368), [chatPageModel.ts:823](src/features/chat/chatPageModel.ts#L823), [sessionStatsCompute.ts:25-30](src/hooks/sessionStatsCompute.ts#L25-L30) |
| | `.state.input` | 6 | [registry.tsx:206](src/features/message/tools/registry.tsx#L206), [:236](src/features/message/tools/registry.tsx#L236), [:252](src/features/message/tools/registry.tsx#L252), [ToolPartView.tsx:564](src/features/message/parts/ToolPartView.tsx#L564), [sessionStatsCompute.ts:24](src/hooks/sessionStatsCompute.ts#L24) |
| | `.state.output` | 4 | [registry.tsx:225-226](src/features/message/tools/registry.tsx#L225-L226), [chatPageModel.ts:100](src/features/chat/chatPageModel.ts#L100), [sessionStatsCompute.ts:27](src/hooks/sessionStatsCompute.ts#L27) |
| | `.state.metadata` | 7 | [registry.tsx:66](src/features/message/tools/registry.tsx#L66), [:207](src/features/message/tools/registry.tsx#L207), [ToolPartView.tsx:557](src/features/message/parts/ToolPartView.tsx#L557), [MessageRenderer.tsx:1374](src/features/message/MessageRenderer.tsx#L1374), [QuestionRenderer.tsx:45](src/features/message/tools/renderers/QuestionRenderer.tsx#L45), [TaskRenderer.tsx:53](src/features/message/tools/renderers/TaskRenderer.tsx#L53) |
| | `.state.error` | 3 | [chatPageModel.ts:100](src/features/chat/chatPageModel.ts#L100), [sessionStatsCompute.ts:30](src/hooks/sessionStatsCompute.ts#L30), [MessageRenderer.tsx:994](src/features/message/MessageRenderer.tsx#L994) |
| | `.state.time.compacted` / `.time.end` | 2 | [sessionStatsCompute.ts:27](src/hooks/sessionStatsCompute.ts#L27), [chatPageModel.ts:843](src/features/chat/chatPageModel.ts#L843) |
| | `.state.raw` | 1 | [sessionStatsCompute.ts:28](src/hooks/sessionStatsCompute.ts#L28) via [:25](src/hooks/sessionStatsCompute.ts#L25) |
| | `.state.title` | 0 direct | (rendered through registry normalisation) |
| | `.state.attachments` | **0** | unread |
| **file** | `.mime` | 19 | [api/message.ts:93](src/api/message.ts#L93), [:100](src/api/message.ts#L100), [attachment/utils.ts:23](src/features/attachment/utils.ts#L23), [:29](src/features/attachment/utils.ts#L29), [useInputHistory.ts:54](src/features/chat/input/useInputHistory.ts#L54), [messageStore.ts:813](src/store/messageStore.ts#L813) |
| | `.url` | 57 (mixed) | [api/message.ts:99](src/api/message.ts#L99), [attachment/utils.ts:28](src/features/attachment/utils.ts#L28), [useInputHistory.ts:65](src/features/chat/input/useInputHistory.ts#L65), [messageStore.ts:825](src/store/messageStore.ts#L825) |
| | `.filename` | 5 | [api/message.ts:98](src/api/message.ts#L98), [attachment/utils.ts:27](src/features/attachment/utils.ts#L27), [useInputHistory.ts:64](src/features/chat/input/useInputHistory.ts#L64), [messageStore.ts:823](src/store/messageStore.ts#L823) |
| | `.source` (+`.path`) | 42 | [attachment/utils.ts:27](src/features/attachment/utils.ts#L27) `part.source?.path`, [useInputHistory.ts:57](src/features/chat/input/useInputHistory.ts#L57), [messageStore.ts:816](src/store/messageStore.ts#L816), [api/message.ts:88](src/api/message.ts#L88) |
| | `.source.text.{value,start,end}` | ✓ | [api/message.ts:102-106](src/api/message.ts#L102-L106), [attachment/utils.ts:34-38](src/features/attachment/utils.ts#L34-L38) |
| | `.source.type/name/kind/range/uri/clientName` | ✓ | [AttachmentItem.tsx:235-256](src/features/attachment/AttachmentItem.tsx#L235-L256) (on `originalSource`) |
| | `.id` | ✓ | [api/message.ts:96](src/api/message.ts#L96), [attachment/utils.ts:25](src/features/attachment/utils.ts#L25) |
| **agent** | `.name` | ✓ | [api/message.ts:114-115](src/api/message.ts#L114-L115), [attachment/utils.ts:58-59](src/features/attachment/utils.ts#L58-L59) |
| | `.source.{value,start,end}` | ✓ | [api/message.ts:116-120](src/api/message.ts#L116-L120), [attachment/utils.ts:60-64](src/features/attachment/utils.ts#L60-L64) |
| **step-finish** | `.tokens.{input,output,reasoning,cache.read,cache.write}` | ✓ | [StepFinishPartView.tsx:38-39](src/features/message/parts/StepFinishPartView.tsx#L38-L39), [:59](src/features/message/parts/StepFinishPartView.tsx#L59), [:67](src/features/message/parts/StepFinishPartView.tsx#L67) |
| | `.cost` | ✓ | [StepFinishPartView.tsx:47](src/features/message/parts/StepFinishPartView.tsx#L47), [:72](src/features/message/parts/StepFinishPartView.tsx#L72) |
| | `.reason` | **0** | declared, unread |
| | `.snapshot` | **0** | declared, unread |
| **subtask** | `.prompt` | ✓ | [SubtaskPartView.tsx:109](src/features/message/parts/SubtaskPartView.tsx#L109) |
| | `.description` | ✓ | [SubtaskPartView.tsx:172](src/features/message/parts/SubtaskPartView.tsx#L172) |
| | `.agent` | ✓ | [SubtaskPartView.tsx:155](src/features/message/parts/SubtaskPartView.tsx#L155), [:185](src/features/message/parts/SubtaskPartView.tsx#L185) |
| | `.model.{providerID,modelID}` | ✓ | [SubtaskPartView.tsx:113](src/features/message/parts/SubtaskPartView.tsx#L113), [:117](src/features/message/parts/SubtaskPartView.tsx#L117) |
| | `.command` | ✓ | [SubtaskPartView.tsx:123](src/features/message/parts/SubtaskPartView.tsx#L123), [:126](src/features/message/parts/SubtaskPartView.tsx#L126) |
| **snapshot** | `.snapshot` | **0** | never rendered |
| **patch** | `.hash` | 1 | [SystemPartViews.tsx:101](src/features/message/parts/SystemPartViews.tsx#L101), [#L116](src/features/message/parts/SystemPartViews.tsx#L116) |
| | `.files` | 1 | [SystemPartViews.tsx:101-102](src/features/message/parts/SystemPartViews.tsx#L101-L102), [:124](src/features/message/parts/SystemPartViews.tsx#L124) |
| **retry** | `.attempt` | ✓ | [SystemPartViews.tsx:22](src/features/message/parts/SystemPartViews.tsx#L22), [:38](src/features/message/parts/SystemPartViews.tsx#L38) |
| | `.error.data.{isRetryable,message,statusCode}` | ✓ | [SystemPartViews.tsx:25](src/features/message/parts/SystemPartViews.tsx#L25), [:53](src/features/message/parts/SystemPartViews.tsx#L53), [:55-57](src/features/message/parts/SystemPartViews.tsx#L55-L57) |
| | `.time.created` | ✓ | [SystemPartViews.tsx:22](src/features/message/parts/SystemPartViews.tsx#L22), [:24](src/features/message/parts/SystemPartViews.tsx#L24) |
| **compaction** | `.auto` | **0** | [SystemPartViews.tsx:77](src/features/message/parts/SystemPartViews.tsx#L77) `void part` — component renders a static divider |
| | `.reason` / `.cost` / `.tokens` | **0** | unread |

### 4.3 Unnarrowed / risky reads

The union is routinely escaped by casting; these read fields that do **not** exist on the union member
that the compiler sees, and will not be caught by a projection that widens types:

| Site | Risk |
| --- | --- |
| [chatPageModel.ts:100](src/features/chat/chatPageModel.ts#L100) `part.state.output?.length ?? part.state.error?.length` | reads `.output` and `.error` without checking `status` |
| [sessionStatsCompute.ts:24-30](src/hooks/sessionStatsCompute.ts#L24-L30) | reads `.input`, `.raw`, `.output`, `.time.compacted`, `.error` across variants |
| [messageStore.ts:35-45](src/store/messageStore.ts#L35-L45) `partHasText` / `mergePartPreferLiveText` | `'text' in part` structural check on the raw union + spread rebuild |
| [MessageRenderer.tsx:994](src/features/message/MessageRenderer.tsx#L994), [:1249-1250](src/features/message/MessageRenderer.tsx#L1249-L1250), [:1368](src/features/message/MessageRenderer.tsx#L1368) | `.state.status` on `Part` narrowed only by `.filter(p => p.type === 'tool')` |
| [ToolPartView.tsx:557](src/features/message/parts/ToolPartView.tsx#L557), [:564](src/features/message/parts/ToolPartView.tsx#L564) | `part.state.metadata as Record<string, unknown>` / `.input as ...` |
| [useSessionManager.ts:64-71](src/hooks/useSessionManager.ts#L64-L71) | `mergePartsForReload` uses `in` operator on `part` |
| [sessionStatsCompute.ts:12-13](src/hooks/sessionStatsCompute.ts#L12-L13) | `part.source?.text.value.length` / `part.source?.value.length` without checking `source.type` |

### 4.4 Part types that do NOT exist in v2

v2 has **no `parts` array**. Assistant content is
`content: Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>`
— i.e. only `text`, `reasoning`, `tool` survive, and **tool state is shaped differently**
(`SessionMessageToolState{Streaming,Running,Completed,Error}` with `content: [ToolContent, ...]`
instead of v1's `output`/`raw`).

| v1 part type | v2 equivalent | UI impact |
| --- | --- | --- |
| `text` | `SessionMessageAssistantText` | direct |
| `reasoning` | `SessionMessageAssistantReasoning` | direct |
| `tool` | `SessionMessageAssistantTool` (`state.status ∈ streaming\|running\|completed\|error`) | `output` → `content[]`; `raw` → `state.input: string` while streaming; **no `pending`** |
| `file` / `agent` | `SessionMessageUser.files[]` / `.agents[]` (`PromptFileAttachment` / `PromptAgentAttachment`) — **on the user message, not in a parts array** | projection must relocate |
| `step-finish` | none — reconstruct from `SessionStepEnded` (`cost`, `tokens`, `finish`) | rendered, needs synthesis |
| `step-start` | none — `SessionStepStarted` event only | filtered only |
| `subtask` | none — sub-sessions via `parentID` / `session.fork` | rendered, needs synthesis |
| `retry` | none — move to `SessionMessageAssistant.retry: {attempt, at, error}` | rendered, needs synthesis + shape change |
| `compaction` | none as a part — v2 has `SessionMessageCompaction{Running,Completed,Failed}` **messages** | rendered; relocate |
| `snapshot` | none — `SessionMessageAssistant.snapshot: {start?, end?, files?}` | filtered only |
| `patch` | none | dead code |

### 4.5 `ModelRef.modelID` vs `id`

v1 `ModelRef = {providerID, modelID, variant?}`; v2 `ModelRef = {id, providerID, variant?}`.
Sites reading `.modelID` off a `ModelRef` (not off `AssistantMessageInfo`):

* [ChatPane.tsx:440](src/features/chat/ChatPane.tsx#L440) `agent.model.providerID}:${agent.model.modelID}`
* [SubtaskPartView.tsx:117](src/features/message/parts/SubtaskPartView.tsx#L117) `part.model.providerID}/{part.model.modelID}`
* [useChatSession.ts:848](src/hooks/useChatSession.ts#L848), [:1031](src/hooks/useChatSession.ts#L1031)
* [useModelSelection.ts:154](src/hooks/useModelSelection.ts#L154) `model.providerID}:${model.modelID}`
* [useSessionManager.ts:318](src/hooks/useSessionManager.ts#L318), [messageStore.ts:474](src/store/messageStore.ts#L474)
* [sessionHelpers.ts:32](src/utils/sessionHelpers.ts#L32), [modelUtils.ts:40](src/utils/modelUtils.ts#L40)

**This is a real v2 type error** — confirmed by tsc at [ChatPane.tsx:440](src/features/chat/ChatPane.tsx#L440)
(`Property 'modelID' does not exist on type 'ModelRef'`) and [messageStoreHooks.test.tsx:35](src/store/messageStoreHooks.test.tsx#L35).
Note `src/types/message.ts` `ModelRef` also uses `modelID` — the UI's own model is v1-shaped, so the
projection must map `id → modelID` at every boundary where a v2 `ModelRef` reaches the UI.

---

## 5. `TodoItem` — **REMOVED in v2, no equivalent**

`TodoItem` is declared in `src/types/api/event.ts:53-56` as `SDKTodo & { id: string }` and re-exported
from `src/types/api/index.ts:121`. Confirmed absent from `@opencode/client` (0 hits for `todo` in `dist/`).
`docs-v2-types.md` §11: *"`session.todo(id)` → **NO v2 EQUIVALENT AT ALL**… Todo functionality was removed, not renamed."*

### 5.1 Producers / core module

| File | Lines | Role |
| --- | --- | --- |
| [src/api/todo.ts](src/api/todo.ts) | 1-33 | `normalizeTodoItems`, `buildTodoId`, status/priority normalisation — **entire file is todo-only** |
| [src/store/todoStore.ts](src/store/todoStore.ts) | 1-171 | `TodoStore`, `SessionTodos`, `TodoStats`, `todoStore`, `useTodos`, `useTodoStats`, `useCurrentTask` — **entire file is todo-only** |
| [src/features/message/tools/renderers/TodoRenderer.tsx](src/features/message/tools/renderers/TodoRenderer.tsx) | 1-~110 | `TodoRenderer`, `TodoList`, `getTodoIcon` — **entire file** |
| [src/features/message/tools/renderers/todoUtils.ts](src/features/message/tools/renderers/todoUtils.ts) | 1-19 | `extractTodos`, `hasTodos` — **entire file** |

### 5.2 Production consumers (file:line)

**API layer**

* [src/api/todo.ts:1](src/api/todo.ts#L1) `import type { Todo as SDKTodo } from '@opencode-ai/sdk/v2/client'`
* [src/api/todo.ts:27](src/api/todo.ts#L27) `normalizeTodoItems(todos: SDKTodo[] …)`
* [src/api/session.ts:8](src/api/session.ts#L8) `import { normalizeTodoItems } from './todo'`
* [src/api/session.ts:15](src/api/session.ts#L15) `import type { TodoItem } from '../types/api/event'`
* [src/api/session.ts:280](src/api/session.ts#L280) `export type ApiTodo = TodoItem`
* [src/api/session.ts:286-290](src/api/session.ts#L286-L290) `getSessionTodos()` → `sdk.session.todo({…})` — **v1-only method**
* [src/api/events.ts:13](src/api/events.ts#L13) `import { normalizeTodoItems } from './todo'`
* [src/api/events.ts:22](src/api/events.ts#L22) `TodoUpdatedPayload` import
* [src/api/events.ts:851-857](src/api/events.ts#L851-L857) `case EventTypes.TODO_UPDATED` → `callbacks.onTodoUpdated?.({sessionID, todos: normalizeTodoItems(payload.properties.todos)})` — **`todo.updated` event does not exist in v2**
* [src/types/api/event.ts:15](src/types/api/event.ts#L15) `EventTodoUpdated`, [:20](src/types/api/event.ts#L20) `Todo`, [:53-60](src/types/api/event.ts#L53-L60) `TodoItem`/`TodoUpdatedPayload`, [:109](src/types/api/event.ts#L109) `TODO_UPDATED: 'todo.updated'`, [:170](src/types/api/event.ts#L170) `onTodoUpdated?`
* [src/types/api/index.ts:121-122](src/types/api/index.ts#L121-L122) re-exports

**Event wiring / state**

* [src/contexts/SessionContext.tsx:10](src/contexts/SessionContext.tsx#L10) `import { todoStore } from '../store/todoStore'`
* [src/contexts/SessionContext.tsx:199-201](src/contexts/SessionContext.tsx#L199-L201) `onTodoUpdated: data => { todoStore.setTodos(data.sessionID, data.todos) }`
* [src/utils/sessionLifecycle.ts:5](src/utils/sessionLifecycle.ts#L5) `import { todoStore } from '../store/todoStore'`
* [src/utils/sessionLifecycle.ts:13](src/utils/sessionLifecycle.ts#L13) `todoStore.clearTodos(id)`
* [src/store/index.ts:56-57](src/store/index.ts#L56-L57) `export { todoStore, useTodos, useTodoStats, useCurrentTask }` / `export type { SessionTodos }`
* [src/main.tsx:72](src/main.tsx#L72) comment only

**API calls (the v1 method)**

* [src/features/chat/input/InputFooter.tsx:7](src/features/chat/input/InputFooter.tsx#L7) `import { getSessionTodos } from '../../../api/session'`
* [src/features/chat/input/InputFooter.tsx:9](src/features/chat/input/InputFooter.tsx#L9) `import type { TodoItem }`
* [src/features/chat/input/InputFooter.tsx:58-61](src/features/chat/input/InputFooter.tsx#L58-L61) `getSessionTodos(sessionId).then(apiTodos => todoStore.setTodos(sessionId, apiTodos))`

**Rendering**

* [src/features/chat/input/InputFooter.tsx:6](src/features/chat/input/InputFooter.tsx#L6) `useTodos, useTodoStats, useCurrentTask, todoStore`
* [src/features/chat/input/InputFooter.tsx:42-43](src/features/chat/input/InputFooter.tsx#L42-L43) `const todos = useTodos(...)`, `const stats = useTodoStats(...)`
* [src/features/chat/input/InputFooter.tsx:53-61](src/features/chat/input/InputFooter.tsx#L53-L61) initial fetch
* [src/features/chat/input/InputFooter.tsx:79-181](src/features/chat/input/InputFooter.tsx#L79-L181) `hasTodos` swap-panel state machine
* [src/features/chat/input/InputFooter.tsx:229-303](src/features/chat/input/InputFooter.tsx#L229-L303) disclaimer/todo swap rendering
* [src/features/chat/input/InputFooter.tsx:310-380](src/features/chat/input/InputFooter.tsx#L310-L380) `TodoSwapPanel`
* [src/features/chat/input/InputFooter.tsx:382-410](src/features/chat/input/InputFooter.tsx#L382-L410) `TodoRow` (reads `todo.status`, `todo.content`, `todo.priority`)
* [src/features/message/parts/ToolPartView.tsx:25-27](src/features/message/parts/ToolPartView.tsx#L25-L27) `TodoRenderer, hasTodos` imports
* [src/features/message/parts/ToolPartView.tsx:541-542](src/features/message/parts/ToolPartView.tsx#L541-L542) `if (lowerTool.includes('todo') && hasTodos(part)) return <TodoRenderer …/>`
* [src/features/message/tools/renderers/index.ts:4-5](src/features/message/tools/renderers/index.ts#L4-L5) exports
* [src/features/message/tools/index.ts:11](src/features/message/tools/index.ts#L11) `export { DefaultRenderer, TodoRenderer, TaskRenderer, hasTodos }`

**Tool-name dispatch**

* [src/features/message/tools/registry.tsx:279-281](src/features/message/tools/registry.tsx#L279-L281) `// Todo (must be before write/read…)` / `match: includes('todo')`
* [src/features/message/MessageRenderer.tsx:1214](src/features/message/MessageRenderer.tsx#L1214) `| 'todo'` (summary category union)
* [src/features/message/MessageRenderer.tsx:1331](src/features/message/MessageRenderer.tsx#L1331) `if (lower.includes('todo')) return 'todo'`
* [src/features/message/MessageRenderer.tsx:953](src/features/message/MessageRenderer.tsx#L953) / [ToolPartView.tsx:474](src/features/message/parts/ToolPartView.tsx#L474) regex `…|todo|question|ask`

**i18n**

* `src/locales/en/message.json:79-81` `todoDone`/`todoActive`/`todoFailed`; `:108` `todo` block
* `src/locales/zh-CN/message.json:63-65`; `:82` `todo` block
* [src/features/settings/components/configEditorMeta.ts:171](src/features/settings/components/configEditorMeta.ts#L171) `{ tool: 'todowrite', … }` — a **tool-name label**, safe to keep

**Unrelated (false positives)**

* [src/components/Icons.tsx:78](src/components/Icons.tsx#L78) `ListTodo` / [:210](src/components/Icons.tsx#L210) `PermissionListIcon` — icon import
* [src/utils/errorHandling.ts:44](src/utils/errorHandling.ts#L44) `// TODO:` comment
* [src/features/mention/useMention.ts:47](src/features/mention/useMention.ts#L47) `// TODO:` comment
* [src/features/message/parts/ToolPartView.tsx:474](src/features/message/parts/ToolPartView.tsx#L474) regex also matches `question`/`ask`

### 5.3 Test consumers

* [src/types/api/index.ts](src/types/api/index.ts) re-export reaches `TodoItem`
* `src/features/message/tools/renderers/TodoRenderer.tsx` / `todoUtils.ts` — no dedicated test file found
* [src/contexts/SessionContext.test.tsx](src/contexts/SessionContext.test.tsx) — session-context level
* [src/store/messageStore.test.ts](src/store/messageStore.test.ts) — no todo usage

> **Note:** no `todoStore.test.ts`, `todoUtils.test.ts` or `TodoRenderer.test.tsx` exists; the todo
> module is under-tested, so removal carries little test churn.

---

## 6. `QuestionRequest` / `PermissionRequest`

### 6.1 `question.*` → `form.*` (v2 replacement)

**API calls (v1, all in [src/api/permission.ts](src/api/permission.ts))**

| Line | Call |
| --- | --- |
| [80](src/api/permission.ts#L80) | `sdk.question.list({ directory })` → `getPendingQuestions` |
| [97](src/api/permission.ts#L97) | `sdk.question.reply({ requestID, directory, answers })` → `replyQuestion` |
| [112](src/api/permission.ts#L112) | `sdk.question.reject({ requestID, directory })` → `rejectQuestion` |

**Event subscriptions**

* [src/api/events.ts:833](src/api/events.ts#L833) `QUESTION_ASKED` → `onQuestionAsked`
* [src/api/events.ts:836](src/api/events.ts#L836) `QUESTION_REPLIED` → `onQuestionReplied`
* [src/api/events.ts:839](src/api/events.ts#L839) `QUESTION_REJECTED` → `onQuestionRejected`
* [src/types/api/event.ts:104-106](src/types/api/event.ts#L104-L106) `QUESTION_ASKED/REPLIED/REJECTED` literals; [:119-120](src/types/api/event.ts#L119-L120) payload aliases
* [src/hooks/useChatSession.ts:430](src/hooks/useChatSession.ts#L430) `onQuestionAsked`, [:448](src/hooks/useChatSession.ts#L448) `onQuestionReplied`, [:451](src/hooks/useChatSession.ts#L451) `onQuestionRejected`
* [src/hooks/useGlobalEvents.ts:44](src/hooks/useGlobalEvents.ts#L44), [:143](src/hooks/useGlobalEvents.ts#L143), [:210](src/hooks/useGlobalEvents.ts#L210)

**`QuestionRequest` / `QuestionInfo` / `QuestionOption` field reads**

| Field | Count | Example |
| --- | --- | --- |
| `request.id` | 4 | [InlineQuestion.tsx:109](src/features/chat/InlineQuestion.tsx#L109), [:124](src/features/chat/InlineQuestion.tsx#L124), [:168](src/features/chat/InlineQuestion.tsx#L168), [ChatPane.tsx:1015](src/features/chat/ChatPane.tsx#L1015) |
| `request.sessionID` | ✓ | [api/permission.ts:83](src/api/permission.ts#L83) `q.sessionID === target.sessionId` |
| `request.questions` | 10+ | [InlineQuestion.tsx:30](src/features/chat/InlineQuestion.tsx#L30), [:100](src/features/chat/InlineQuestion.tsx#L100), [:142](src/features/chat/InlineQuestion.tsx#L142), [QuestionDialog.tsx:34](src/features/chat/QuestionDialog.tsx#L34), [:116](src/features/chat/QuestionDialog.tsx#L116), [:225](src/features/chat/QuestionDialog.tsx#L225) |
| `question.header` | 4 | [InlineQuestion.tsx:229-230](src/features/chat/InlineQuestion.tsx#L229-L230), [QuestionDialog.tsx:324](src/features/chat/QuestionDialog.tsx#L324), [useChatSession.ts:437](src/hooks/useChatSession.ts#L437), [useGlobalEvents.ts:693](src/hooks/useGlobalEvents.ts#L693) |
| `question.question` | 2 | [InlineQuestion.tsx:232](src/features/chat/InlineQuestion.tsx#L232), [QuestionDialog.tsx:325](src/features/chat/QuestionDialog.tsx#L325) |
| `question.options` | 4 | [InlineQuestion.tsx:237](src/features/chat/InlineQuestion.tsx#L237), [QuestionDialog.tsx:330](src/features/chat/QuestionDialog.tsx#L330) |
| `option.label` | 7 | [InlineQuestion.tsx:238](src/features/chat/InlineQuestion.tsx#L238), [:242](src/features/chat/InlineQuestion.tsx#L242), [:261](src/features/chat/InlineQuestion.tsx#L261), [QuestionDialog.tsx:331](src/features/chat/QuestionDialog.tsx#L331), [:336](src/features/chat/QuestionDialog.tsx#L336), [:344](src/features/chat/QuestionDialog.tsx#L344), [QuestionRenderer.tsx:91](src/features/message/tools/renderers/QuestionRenderer.tsx#L91), [:111](src/features/message/tools/renderers/QuestionRenderer.tsx#L111) |
| `option.description` | 2 | [InlineQuestion.tsx:243](src/features/chat/InlineQuestion.tsx#L243), [QuestionDialog.tsx:345-346](src/features/chat/QuestionDialog.tsx#L345-L346) |
| `question.multiple` | 6 | [InlineQuestion.tsx:104](src/features/chat/InlineQuestion.tsx#L104), [:207](src/features/chat/InlineQuestion.tsx#L207), [QuestionDialog.tsx:121](src/features/chat/QuestionDialog.tsx#L121), [:144](src/features/chat/QuestionDialog.tsx#L144), [:293](src/features/chat/QuestionDialog.tsx#L293) |
| `question.custom` | 4 | [InlineQuestion.tsx:105](src/features/chat/InlineQuestion.tsx#L105), [:208](src/features/chat/InlineQuestion.tsx#L208), [QuestionDialog.tsx:123](src/features/chat/QuestionDialog.tsx#L123), [:294](src/features/chat/QuestionDialog.tsx#L294) |
| `request.tool.callID` | 1 | [InlineToolRequestContext.tsx:103](src/features/chat/InlineToolRequestContext.tsx#L103) `pendingQuestions.find(q => q.tool?.callID === callID)` |
| `metadata.answers` | 1 | [QuestionRenderer.tsx:214-215](src/features/message/tools/renderers/QuestionRenderer.tsx#L214-L215) |

Producers of `QuestionAnswer[]`: [InlineQuestion.tsx:100](src/features/chat/InlineQuestion.tsx#L100), [QuestionDialog.tsx:116](src/features/chat/QuestionDialog.tsx#L116) — both build `string[]` per question, matching v1 `QuestionAnswer = Array<string>`.

**v2 status:** `question.*` is **REMOVED**; `FormInfo = {id, sessionID, title, metadata?, fields: [FormField, ...]}`.
The v1 shape (`questions: QuestionInfo[]` where each has `header`/`question`/`options[]`/`multiple?`/`custom?`)
has **no structural counterpart**: v2 `fields` is a flat discriminated union over
`type ∈ string | number | integer | boolean | multiselect | external`, each with `key`/`title?`/`description?`/`required?`/`hidden?`/`when?`.

**Projection feasibility:** a *choice-only* form (`multiselect`, or `string` with `options`) can be
projected into one synthetic `QuestionInfo` (`header ← title`, `question ← title`, `options ← options`,
`multiple ← type === 'multiselect'`, `custom ← false`). **Non-choice fields (`number`, `integer`,
`boolean`, `external`, option-less `string`) have no representation in the v1 UI at all** — those are
unavoidable UI edits. `answers` is also a different shape: v1 `string[][]`, v2 `FormAnswer = {[key]: FormValue}`.

### 6.2 `PermissionRequest`

**API calls** — [src/api/permission.ts](src/api/permission.ts): [:24](src/api/permission.ts#L24) `permission.list`, [:46](src/api/permission.ts#L46) `permission.respond` (v1-only), [:57](src/api/permission.ts#L57) `permission.reply`.

**Event subscriptions** — [src/api/events.ts:827](src/api/events.ts#L827) `PERMISSION_ASKED`, [:830](src/api/events.ts#L830) `PERMISSION_REPLIED`.

**Field reads**

| Field | Count | Example | v2 status |
| --- | --- | --- | --- |
| `.id` | 6 | [usePermissionHandler.ts:56](src/hooks/usePermissionHandler.ts#L56), [:107](src/hooks/usePermissionHandler.ts#L107), [:214-215](src/hooks/usePermissionHandler.ts#L214-L215), [InlinePermission.tsx:65](src/features/chat/InlinePermission.tsx#L65) | exists |
| `.sessionID` | 6 | [api/permission.ts:27](src/api/permission.ts#L27), [InlinePermission.tsx:64](src/features/chat/InlinePermission.tsx#L64), [PermissionDialog.tsx:58-64](src/features/chat/PermissionDialog.tsx#L58-L64), [:188-189](src/features/chat/PermissionDialog.tsx#L188-L189) | exists |
| `.metadata` (`?.diff`, `?.filepath`, `?.filediff`) | 2 | [InlinePermission.tsx:37-43](src/features/chat/InlinePermission.tsx#L37-L43), [PermissionDialog.tsx:36-45](src/features/chat/PermissionDialog.tsx#L36-L45) | exists (`{[x]: JsonValue}`) |
| `.permission` | 9 | [InlinePermission.tsx:55](src/features/chat/InlinePermission.tsx#L55), [:64](src/features/chat/InlinePermission.tsx#L64), [:79](src/features/chat/InlinePermission.tsx#L79), [:88](src/features/chat/InlinePermission.tsx#L88), [PermissionDialog.tsx:55](src/features/chat/PermissionDialog.tsx#L55), [:96](src/features/chat/PermissionDialog.tsx#L96), [:188-189](src/features/chat/PermissionDialog.tsx#L188-L189) | **RENAMED → `action`** |
| `.patterns` | 5 | [InlinePermission.tsx:56-57](src/features/chat/InlinePermission.tsx#L56-L57), [:61](src/features/chat/InlinePermission.tsx#L61), [PermissionDialog.tsx:145-148](src/features/chat/PermissionDialog.tsx#L145-L148), [:184](src/features/chat/PermissionDialog.tsx#L184) | **RENAMED → `resources`** |
| `.always` | 4 | [InlinePermission.tsx:61](src/features/chat/InlinePermission.tsx#L61), [PermissionDialog.tsx:156-159](src/features/chat/PermissionDialog.tsx#L156-L159), [:184](src/features/chat/PermissionDialog.tsx#L184) | **RENAMED → `save`** (semantics differ: `save` is what to persist) |
| `.tool.callID` | 1 | [InlineToolRequestContext.tsx:69](src/features/chat/InlineToolRequestContext.tsx#L69) | **REMOVED** from `PermissionRequest`; v2 `PermissionSource = {type:'tool', messageID, id}` — project `callID ← source.id` |
| `.tool.messageID` | 0 | — | via `PermissionSource.messageID` |
| `.action` / `.resources` / `.save` / `.message` | 0 | — | v2-only, unread |

`PermissionReply` (`'once' | 'always' | 'reject'`) is read at [usePermissionHandler.ts:94](src/hooks/usePermissionHandler.ts#L94) and constructed in the dialogs; v2's reply field is **`decision`** with the *same* three literals (per `docs-v2-types.md` §4.5).

**Local declaration divergence (must be reconciled):**

| File | Divergence |
| --- | --- |
| [src/types/api/permission.ts](src/types/api/permission.ts) (at audit start) | aliased `PermissionRequest = SDKPermissionRequest` from the **stale** `@opencode-ai/sdk/v2/client` (with `permission`/`patterns`/`always`/`tool`), and derived `PermissionToolInfo = NonNullable<SDKPermissionRequest['tool']>`. True v2 has neither. During the concurrent rewrite this file was changed to define a synthetic `PermissionToolInfo {action?, resources?, source?}`. |
| [src/types/api/event.ts](src/types/api/event.ts) (at audit start) | declared `TodoItem`, `TodoUpdatedPayload`, `QuestionRepliedPayload`, `QuestionRejectedPayload` against the stale surface. |

---

## 7. `MCPStatus*`

Declared in `src/types/api/mcp.ts`. Consumed in [src/components/McpPanel.tsx](src/components/McpPanel.tsx)
and [src/api/mcp.ts](src/api/mcp.ts).

### 7.1 Field reads

| Field | Count | Example | v2 status |
| --- | --- | --- | --- |
| `status.status` | 6 switches | [McpPanel.tsx:490](src/components/McpPanel.tsx#L490), [:493](src/components/McpPanel.tsx#L493), [:504](src/components/McpPanel.tsx#L504), [:529](src/components/McpPanel.tsx#L529), [:576](src/components/McpPanel.tsx#L576) | exists |
| `status.error` | 2 | [McpPanel.tsx:491](src/components/McpPanel.tsx#L491) (`failed`), [:494](src/components/McpPanel.tsx#L494) (`needs_client_registration`) | exists on `failed` (`{status:'failed', error:string}`) and `needs_auth`; **`needs_client_registration` no longer exists** |
| `server.name` | ✓ | [McpPanel.tsx:485](src/components/McpPanel.tsx#L485), [:612](src/components/McpPanel.tsx#L612) | v2 `McpServer {name, status, integrationID?}` |
| `server.resources` | 6 | [McpPanel.tsx:500](src/components/McpPanel.tsx#L500), [:616-618](src/components/McpPanel.tsx#L616-L618), [:640-647](src/components/McpPanel.tsx#L640-L647) | **not on `McpServer`** — resources come from a separate catalog call |
| `resource.description` | 1 | [McpPanel.tsx:657-659](src/components/McpPanel.tsx#L657-L659) | v2 `McpResource` has `description?` |
| `resource.name` | ✓ | [McpPanel.tsx:650](src/components/McpPanel.tsx#L650) | exists |
| `resource.uri` | ✓ | [McpPanel.tsx:648](src/components/McpPanel.tsx#L648), [:662](src/components/McpPanel.tsx#L662) | exists |
| `resource.mimeType` | 0 | — | exists, unread |
| `resource.server` | 0 | — | exists, unread |

`status.status` case labels actually handled: `connected`, `disabled`, `failed`, `needs_auth`,
**`needs_client_registration`** ([McpPanel.tsx:493](src/components/McpPanel.tsx#L493), [:513](src/components/McpPanel.tsx#L513), [:556](src/components/McpPanel.tsx#L556), [:584](src/components/McpPanel.tsx#L584)).
v2 replaced that with `McpStatusPending` (`{status:'pending'}`) — see
`docs-v2-types.md` §12: *"`McpStatus` … the five member types are `McpStatusConnected`, `McpStatusPending`, `McpStatusDisabled`, `McpStatusFailed`, `McpStatusNeedsAuth`."*

### 7.2 API calls

| Line | Call | v2 status |
| --- | --- | --- |
| [src/api/mcp.ts:14](src/api/mcp.ts#L14) | `sdk.mcp.status({directory})` | **method renamed** → `mcp.list()` (returns `{location, data}`) |
| [src/api/mcp.ts:22](src/api/mcp.ts#L22) | `sdk.mcp.resource(...)` | renamed/reshaped → resource catalog |
| [src/api/mcp.ts:30](src/api/mcp.ts#L30) | `sdk.mcp.add({name, config, directory})` | `name` no longer an input field |
| [src/api/mcp.ts:38](src/api/mcp.ts#L38) | `sdk.mcp.connect({name, directory})` | `name` no longer an input field |
| [src/api/mcp.ts:46](src/api/mcp.ts#L46) | `sdk.mcp.disconnect({name, directory})` | same |
| [src/api/mcp.ts:54-80](src/api/mcp.ts#L54-L80) | `sdk.mcp.auth.{start,remove,callback,authenticate}` | `mcp.auth.*` restructured |

Also `McpLocalConfig.timeout` changed from `number` to `{startup?, catalog?, execution?}` — flagged by tsc at
[mcp.ts:30](src/api/mcp.ts#L30).

---

## 8. Direct `@opencode-ai/sdk` type usage in UI code

**Result: clean.** No UI file (anything outside `src/types/api/` and `src/api/`) imports
`@opencode-ai/sdk` or `@opencode/client`.

All 27 `@opencode*` import sites:

| Area | Files |
| --- | --- |
| `src/api/` | [sdk.ts:13-14](src/api/sdk.ts#L13-L14) `OpenCode`, `OpenCodeClient` from `@opencode/client/promise`; [global.ts:5](src/api/global.ts#L5); [lsp.ts:5](src/api/lsp.ts#L5); [todo.ts:1](src/api/todo.ts#L1) |
| `src/types/api/` | agent, common, config, event, file, mcp, message, model, permission, project, pty, session, skill, tool, vcs, worktree |
| tests | [src/api/sdk.test.ts:10](src/api/sdk.test.ts#L10) `vi.mock('@opencode-ai/sdk/v2/client')` |

**Consequence:** the SDK boundary is already funnelled through `src/api/*` + `src/types/api/*`.
**No hard migration blocker here** — the projection layer has a single, well-defined place to live.
The only caveat is the stale-vs-authoritative surface split (§0 Caveat A) and the stale mock in
[sdk.test.ts:10](src/api/sdk.test.ts#L10), which must be re-pointed at `@opencode/client/promise`.

---

## 9. v1 method names called as API

| v1 name | Call sites | v2 equivalent |
| --- | --- | --- |
| `.status(` | [session.ts:31](src/api/session.ts#L31) `sdk.session.status` → **RENAMED `session.active()`** | — |
| | [file.ts:108](src/api/file.ts#L108) `sdk.file.status`, [lsp.ts:20](src/api/lsp.ts#L20) `sdk.lsp.status`, [lsp.ts:42](src/api/lsp.ts#L42) `sdk.formatter.status`, [mcp.ts:14](src/api/mcp.ts#L14) `sdk.mcp.status` | these are *different* namespaces; `mcp.status` → `mcp.list` |
| `.share(` | [session.ts:220](src/api/session.ts#L220) `sdk.session.share` | **REMOVED** → `session.export()` |
| `.unshare(` | [session.ts:229](src/api/session.ts#L229) `sdk.session.unshare` | **REMOVED** (no equivalent) |
| `.summarize(` | [session.ts:259](src/api/session.ts#L259) `sdk.session.summarize` | **RENAMED** → `session.compact()` |
| `.todo(` | [session.ts:289](src/api/session.ts#L289) `sdk.session.todo` | **REMOVED** |
| `.children(` | [session.ts:274](src/api/session.ts#L274) `sdk.session.children` | **REMOVED** → `session.list({parentID})` |
| `.abort(` | [session.ts:179](src/api/session.ts#L179) `sdk.session.abort` | **RENAMED** → `session.interrupt()` |
| `.unrevert(` | [session.ts:211](src/api/session.ts#L211) `sdk.session.unrevert` | **RENAMED** → `session.revert.clear()` |
| `.revert(` | [session.ts:196](src/api/session.ts#L196) `sdk.session.revert` | **SPLIT** → `session.revert.stage()` |
| `.messages(` | [message.ts:63](src/api/message.ts#L63) `sdk.session.messages` | **MOVED** → `client.message.list()`; returns `{data, cursor}` |
| `.promptAsync(` | [message.ts:241](src/api/message.ts#L241) `sdk.session.promptAsync` | **REMOVED** — v2 `session.prompt()` enqueues |
| `.prompt(` | [message.ts:232](src/api/message.ts#L232) `sdk.session.prompt` | exists; input has **no `parts`** (uses `text`/`files`/`agents`/`references`) and **no `directory`** |
| `permission.respond` | [permission.ts:46](src/api/permission.ts#L46) | **REMOVED** → `permission.reply({sessionID, requestID, decision})` |
| `question.{list,reply,reject}` | [permission.ts:80](src/api/permission.ts#L80), [:97](src/api/permission.ts#L97), [:112](src/api/permission.ts#L112) | **REMOVED** → `form.*` |
| `delete` | [session.ts:165](src/api/session.ts#L165) `sdk.session.delete` | **RENAMED** → `session.remove()` |
| `roots` param | [SessionContext.tsx:70](src/contexts/SessionContext.tsx#L70), [SearchResults.tsx:121](src/features/chat/sidebar/SearchResults.tsx#L121), [useSessions.ts:138](src/hooks/useSessions.ts#L138) | **REMOVED** → `parentID` |

**Downstream callers of these API functions** (they take `directory` as an argument and will keep
compiling, hiding the breakage): `shareSession`/`unshareSession` ([ShareDialog.tsx:33](src/features/chat/ShareDialog.tsx#L33), [:48](src/features/chat/ShareDialog.tsx#L48)), `summarizeSession` ([useChatSession.ts:35](src/hooks/useChatSession.ts#L35), [:1029](src/hooks/useChatSession.ts#L1029)), `getSessionChildren` ([SessionChildrenSlot.tsx:64](src/features/chat/sidebar/SessionChildrenSlot.tsx#L64)), `abortSession`, `revertMessage`.

---

## MIGRATION BLOCKERS

UI code reading a field/type that **does not exist in v2** (authoritative `@opencode/client` 2.0.21).
Each entry is either projectable (P) or an unavoidable UI edit (U).

### B1 — `Session.directory` (renamed to `location.directory`) — **P, but 123 sites**

* [SessionList.tsx:476](src/features/sessions/SessionList.tsx#L476), [:592](src/features/sessions/SessionList.tsx#L592), [:856-860](src/features/sessions/SessionList.tsx#L856-L860)
* [SessionContext.tsx:80-81](src/contexts/SessionContext.tsx#L80-L81), [:129](src/contexts/SessionContext.tsx#L129)
* [useSessions.ts:109](src/hooks/useSessions.ts#L109), [:149-151](src/hooks/useSessions.ts#L149-L151)
* [useSessionManager.ts:165](src/hooks/useSessionManager.ts#L165), [:206](src/hooks/useSessionManager.ts#L206), [:220](src/hooks/useSessionManager.ts#L220)
* [useChatSession.ts:687](src/hooks/useChatSession.ts#L687), [:941](src/hooks/useChatSession.ts#L941), [:965](src/hooks/useChatSession.ts#L965), [:1018](src/hooks/useChatSession.ts#L1018), [:1089](src/hooks/useChatSession.ts#L1089), [:1118](src/hooks/useChatSession.ts#L1118), [:1121](src/hooks/useChatSession.ts#L1121), [:1131](src/hooks/useChatSession.ts#L1131)
* [SidePanel.tsx:481](src/features/chat/sidebar/SidePanel.tsx#L481), [:868-869](src/features/chat/sidebar/SidePanel.tsx#L868-L869), [:906-911](src/features/chat/sidebar/SidePanel.tsx#L906-L911), [:983](src/features/chat/sidebar/SidePanel.tsx#L983), [:985](src/features/chat/sidebar/SidePanel.tsx#L985), [:997](src/features/chat/sidebar/SidePanel.tsx#L997), [:1000](src/features/chat/sidebar/SidePanel.tsx#L1000), [:1026](src/features/chat/sidebar/SidePanel.tsx#L1026)
* [MultiServerFolderList.tsx:257-267](src/features/chat/sidebar/MultiServerFolderList.tsx#L257-L267), [SessionChildrenSlot.tsx:64-102](src/features/chat/sidebar/SessionChildrenSlot.tsx#L64-L102), [SearchResults.tsx:180-188](src/features/chat/sidebar/SearchResults.tsx#L180-L188), [ActiveSessionItem.tsx:22](src/features/chat/sidebar/ActiveSessionItem.tsx#L22), [NotificationItem.tsx:35](src/features/chat/sidebar/NotificationItem.tsx#L35), [App.tsx:222](src/App.tsx#L222)

### B2 — `Session.share` — **REMOVED**

* [ShareDialog.tsx:34](src/features/chat/ShareDialog.tsx#L34) `updatedSession.share?.url`
* [useSessionManager.ts:167](src/hooks/useSessionManager.ts#L167), [:209](src/hooks/useSessionManager.ts#L209), [:224](src/hooks/useSessionManager.ts#L224) `shareUrl: sessionInfo?.share?.url`
* producer: [api/session.ts:220](src/api/session.ts#L220) `sdk.session.share` (method removed)

### B3 — `Session.summary` — **REMOVED**

* [SessionList.tsx:441-442](src/features/sessions/SessionList.tsx#L441-L442), [:698](src/features/sessions/SessionList.tsx#L698), [:702-710](src/features/sessions/SessionList.tsx#L702-L710), [:844-852](src/features/sessions/SessionList.tsx#L844-L852) — `.additions`/`.deletions`/`.files`

### B4 — `{info, parts}` envelope — **STRUCTURE REMOVED** (272 read sites)

Projection seam already exists: [src/utils/messageConversion.ts:5-17](src/utils/messageConversion.ts#L5-L17).

### B5 — `info.role` → `type` (58 sites); `info.sessionID` absent on messages (2 sites)

* [ChatArea.tsx:141](src/features/chat/ChatArea.tsx#L141), [chatAreaUtils.ts:11](src/features/chat/chatAreaUtils.ts#L11), [outlineIndexModel.ts:21](src/components/outlineIndexModel.ts#L21), [chatPageModel.ts](src/features/chat/chatPageModel.ts), [messageStore.ts:564-572](src/store/messageStore.ts#L564-L572)
* [messageStore.ts:374](src/store/messageStore.ts#L374), [:387](src/store/messageStore.ts#L387), [:549](src/store/messageStore.ts#L549), [:572](src/store/messageStore.ts#L572)
* [types/index.ts:42-47](src/types/index.ts#L42-L47) — already erroring

### B6 — `info.modelID` / `info.providerID` flat fields — **moved under `model`**

* [MessageRenderer.tsx:797](src/features/message/MessageRenderer.tsx#L797) `assistantInfo?.modelID`
* [ContextDetailsDialog.tsx:102](src/features/chat/sidebar/ContextDetailsDialog.tsx#L102), [:106](src/features/chat/sidebar/ContextDetailsDialog.tsx#L106)

### B7 — `ModelRef.modelID` → `ModelRef.id` — **U (type error, 6 files)**

* [ChatPane.tsx:440](src/features/chat/ChatPane.tsx#L440) ← tsc error
* [SubtaskPartView.tsx:117](src/features/message/parts/SubtaskPartView.tsx#L117)
* [useChatSession.ts:848](src/hooks/useChatSession.ts#L848), [useModelSelection.ts:154](src/hooks/useModelSelection.ts#L154), [useSessionManager.ts:318](src/hooks/useSessionManager.ts#L318), [messageStore.ts:474](src/store/messageStore.ts#L474), [sessionHelpers.ts:32](src/utils/sessionHelpers.ts#L32), [modelUtils.ts:40](src/utils/modelUtils.ts#L40)

### B8 — Tool `state.output` / `state.raw` — **U unless projected**

v2 completed tool state carries `content: [ToolContent, ...]`, not `output`; streaming carries
`input: string` and there is **no `pending`** status.

* [registry.tsx:225-226](src/features/message/tools/registry.tsx#L225-L226), [chatPageModel.ts:100](src/features/chat/chatPageModel.ts#L100), [sessionStatsCompute.ts:25-28](src/hooks/sessionStatsCompute.ts#L25-L28)
* `pending` checks: [ToolPartView.tsx:61](src/features/message/parts/ToolPartView.tsx#L61), [BashRenderer.tsx:28](src/features/message/tools/renderers/BashRenderer.tsx#L28), [DefaultRenderer.tsx:20](src/features/message/tools/renderers/DefaultRenderer.tsx#L20), [QuestionRenderer.tsx:42](src/features/message/tools/renderers/QuestionRenderer.tsx#L42), [TaskRenderer.tsx:37](src/features/message/tools/renderers/TaskRenderer.tsx#L37), [:56](src/features/message/tools/renderers/TaskRenderer.tsx#L56), [:217](src/features/message/tools/renderers/TaskRenderer.tsx#L217), [:467](src/features/message/tools/renderers/TaskRenderer.tsx#L467), [MessageRenderer.tsx:1368](src/features/message/MessageRenderer.tsx#L1368), [chatPageModel.ts:823](src/features/chat/chatPageModel.ts#L823)

### B9 — `RetryPart` and `error.data.{isRetryable,statusCode}` — **U**

* [SystemPartViews.tsx:17-65](src/features/message/parts/SystemPartViews.tsx#L17-L65) — `RetryPartView` reads `error.data.isRetryable` ([:25](src/features/message/parts/SystemPartViews.tsx#L25)), `error.data.message` ([:53](src/features/message/parts/SystemPartViews.tsx#L53)), `error.data.statusCode` ([:55-57](src/features/message/parts/SystemPartViews.tsx#L55-L57))
* [MessageErrorView.tsx:91](src/features/message/parts/MessageErrorView.tsx#L91), [:105](src/features/message/parts/MessageErrorView.tsx#L105), [:111-116](src/features/message/parts/MessageErrorView.tsx#L111-L116), [:123](src/features/message/parts/MessageErrorView.tsx#L123)
* v2 has no `ApiError` in `@opencode/client`; v2 `SessionStructuredError = {type, message, status?, response?}` and `SessionMessageAssistantRetry = {attempt, at, error}`.

### B10 — Part types `step-finish` / `subtask` / `retry` / `compaction` — **P (synthesise) or U**

Rendered but with no v2 part source: [MessageRenderer.tsx:884-903](src/features/message/MessageRenderer.tsx#L884-L903).
Sources: `SessionStepEnded` (step-finish), sub-sessions via `parentID`/`fork` (subtask),
`SessionMessageAssistant.retry` (retry), `SessionMessageCompaction*` messages (compaction).

### B11 — `question.*` API + `QuestionRequest` field model — **U for non-choice fields**

* API: [permission.ts:80](src/api/permission.ts#L80), [:97](src/api/permission.ts#L97), [:112](src/api/permission.ts#L112); events [events.ts:833-841](src/api/events.ts#L833-L841)
* UI: [InlineQuestion.tsx](src/features/chat/InlineQuestion.tsx) (all of it), [QuestionDialog.tsx](src/features/chat/QuestionDialog.tsx) (all of it), [QuestionRenderer.tsx](src/features/message/tools/renderers/QuestionRenderer.tsx), [usePermissionHandler.ts:133-179](src/hooks/usePermissionHandler.ts#L133-L179), [ChatPane.tsx:783-1017](src/features/chat/ChatPane.tsx#L783-L1017)

### B12 — `PermissionRequest.{permission,patterns,always,tool}` — **P (lossy) / U**

* [InlinePermission.tsx:55-64](src/features/chat/InlinePermission.tsx#L55-L64), [:79-88](src/features/chat/InlinePermission.tsx#L79-L88), [PermissionDialog.tsx:55-64](src/features/chat/PermissionDialog.tsx#L55-L64), [:96](src/features/chat/PermissionDialog.tsx#L96), [:145-159](src/features/chat/PermissionDialog.tsx#L145-L159), [:184-189](src/features/chat/PermissionDialog.tsx#L184-L189)
* `tool.callID` correlation: [InlineToolRequestContext.tsx:69](src/features/chat/InlineToolRequestContext.tsx#L69)
* v2 has no `always`; `save` differs semantically, so auto-approve rule capture ([PermissionDialog.tsx:184-189](src/features/chat/PermissionDialog.tsx#L184-L189)) needs a decision.

### B13 — `roots` removed from `SessionListInput` — **U**

* [SessionContext.tsx:70](src/contexts/SessionContext.tsx#L70) `roots: true`, [SearchResults.tsx:121](src/features/chat/sidebar/SearchResults.tsx#L121) `roots: false`, [useSessions.ts:138](src/hooks/useSessions.ts#L138) `roots: rootsOnly`, [api/session.ts:94-99](src/api/session.ts#L94-L99)

### B14 — `MCPStatus.needs_client_registration` removed — **U (small)**

* [McpPanel.tsx:493](src/components/McpPanel.tsx#L493), [:513](src/components/McpPanel.tsx#L513), [:556](src/components/McpPanel.tsx#L556), [:584](src/components/McpPanel.tsx#L584)
* v2 adds `pending`; max progress bar at [McpPanel.tsx:87-88](src/components/McpPanel.tsx#L87-L88)

### B15 — `session.agent` — low risk

* [childSessionStore.ts:83](src/store/childSessionStore.ts#L83) — **exists** in v2, no action.

---

## TODO REMOVAL

Complete deletion/stub plan. v2 has **no todo type, no `session.todo()`, no `todo.updated` event**.

### Delete outright (4 files, all todo-only)

| File | Reason |
| --- | --- |
| [src/api/todo.ts](src/api/todo.ts) | `normalizeTodoItems` + `SDKTodo` import only |
| [src/store/todoStore.ts](src/store/todoStore.ts) | whole store + hooks are todo-only |
| [src/features/message/tools/renderers/TodoRenderer.tsx](src/features/message/tools/renderers/TodoRenderer.tsx) | todo renderer |
| [src/features/message/tools/renderers/todoUtils.ts](src/features/message/tools/renderers/todoUtils.ts) | `extractTodos` / `hasTodos` |

### Edit

| File:line | Change |
| --- | --- |
| [src/api/session.ts:15](src/api/session.ts#L15), [:278-291](src/api/session.ts#L278-L291) | drop `getSessionTodos`, `ApiTodo`, `TodoItem` import, `normalizeTodoItems` import ([:8](src/api/session.ts#L8)) |
| [src/api/events.ts:13](src/api/events.ts#L13), [:851-857](src/api/events.ts#L851-L857) | delete `TODO_UPDATED` case |
| [src/types/api/event.ts:15](src/types/api/event.ts#L15), [:20](src/types/api/event.ts#L20), [:53-60](src/types/api/event.ts#L53-L60), [:109](src/types/api/event.ts#L109), [:170](src/types/api/event.ts#L170) | delete `TodoItem`, `TodoUpdatedPayload`, `TODO_UPDATED`, `onTodoUpdated` |
| [src/types/api/index.ts:121-122](src/types/api/index.ts#L121-L122) | drop re-exports |
| [src/contexts/SessionContext.tsx:10](src/contexts/SessionContext.tsx#L10), [:199-201](src/contexts/SessionContext.tsx#L199-L201) | drop `onTodoUpdated` handler + import |
| [src/utils/sessionLifecycle.ts:5](src/utils/sessionLifecycle.ts#L5), [:13](src/utils/sessionLifecycle.ts#L13) | drop `todoStore.clearTodos` |
| [src/store/index.ts:56-57](src/store/index.ts#L56-L57) | drop exports |
| [src/features/chat/input/InputFooter.tsx:6-9](src/features/chat/input/InputFooter.tsx#L6-L9), [:42-43](src/features/chat/input/InputFooter.tsx#L42-L43), [:53-61](src/features/chat/input/InputFooter.tsx#L53-L61), [:79-181](src/features/chat/input/InputFooter.tsx#L79-L181), [:229-303](src/features/chat/input/InputFooter.tsx#L229-L303), [:310-410](src/features/chat/input/InputFooter.tsx#L310-L410) | remove the whole todo swap-panel state machine + `TodoSwapPanel` + `TodoRow`; revert footer to disclaimer only |
| [src/features/message/parts/ToolPartView.tsx:25-27](src/features/message/parts/ToolPartView.tsx#L25-L27), [:541-542](src/features/message/parts/ToolPartView.tsx#L541-L542) | drop `TodoRenderer`/`hasTodos` dispatch |
| [src/features/message/tools/renderers/index.ts:4-5](src/features/message/tools/renderers/index.ts#L4-L5) | drop exports |
| [src/features/message/tools/index.ts:11](src/features/message/tools/index.ts#L11) | drop from barrel |
| [src/features/message/tools/registry.tsx:279-281](src/features/message/tools/registry.tsx#L279-L281) | drop the todo match entry |
| [src/features/message/MessageRenderer.tsx:1214](src/features/message/MessageRenderer.tsx#L1214), [:1331](src/features/message/MessageRenderer.tsx#L1331) | drop `'todo'` from the summary-category union + mapper |
| [src/locales/en/message.json:79-81](src/locales/en/message.json#L79-L81), [:108](src/locales/en/message.json#L108) and the `zh-CN` twins | drop `todoDone`/`todoActive`/`todoFailed` + `todo` block |

### Keep (not todo-domain)

* [src/components/Icons.tsx:78](src/components/Icons.tsx#L78) `ListTodo` icon + [:210](src/components/Icons.tsx#L210) `PermissionListIcon`
* [src/features/settings/components/configEditorMeta.ts:171](src/features/settings/components/configEditorMeta.ts#L171) `todowrite` label — harmless if the tool disappears
* `TODO:` comments at [src/utils/errorHandling.ts:44](src/utils/errorHandling.ts#L44), [src/features/mention/useMention.ts:47](src/features/mention/useMention.ts#L47)
* the `todo|question|ask` regexes at [ToolPartView.tsx:474](src/features/message/parts/ToolPartView.tsx#L474) / [MessageRenderer.tsx:953](src/features/message/MessageRenderer.tsx#L953) — narrow to `question|ask`

---

## 10. Current typecheck breakage (UI side)

Snapshot: `npx tsc --noEmit -p tsconfig.app.json` → **239 errors** (154 in `src/types/api` + `src/api`).

UI-file errors grouped by cause:

| Cause | Errors | Files |
| --- | --- | --- |
| `Session.directory` missing | ~40 | [SessionList.tsx](src/features/sessions/SessionList.tsx) (24), [SidePanel.tsx](src/features/chat/sidebar/SidePanel.tsx) (13), [SessionChildrenSlot.tsx](src/features/chat/sidebar/SessionChildrenSlot.tsx) (6), [SearchResults.tsx](src/features/chat/sidebar/SearchResults.tsx) (4), [MultiServerFolderList.tsx](src/features/chat/sidebar/MultiServerFolderList.tsx) (4), [useChatSession.ts](src/hooks/useChatSession.ts) (8), [useSessions.ts](src/hooks/useSessions.ts) (3), [useGlobalEvents.ts](src/hooks/useGlobalEvents.ts) (2), [useSessionManager.ts](src/hooks/useSessionManager.ts) (3), [SessionContext.tsx](src/contexts/SessionContext.tsx) (3), [ActiveSessionItem.tsx](src/features/chat/sidebar/ActiveSessionItem.tsx) (1), [NotificationItem.tsx](src/features/chat/sidebar/NotificationItem.tsx) (1) |
| `Session.summary` missing | 18 | [SessionList.tsx](src/features/sessions/SessionList.tsx) |
| `Session.share` missing | 4 | [useSessionManager.ts:167,209,224](src/hooks/useSessionManager.ts#L167), [ShareDialog.tsx:34](src/features/chat/ShareDialog.tsx#L34) |
| `SessionMessage` has no `sessionID`/`role` | 9 | [messageStore.ts:549,564,567,572](src/store/messageStore.ts#L549-L572), [types/index.ts:42,47](src/types/index.ts#L42-L47), [messageConversion.ts:20](src/utils/messageConversion.ts#L20), [useGlobalEvents.ts:512](src/hooks/useGlobalEvents.ts#L512), [messageStore.test.ts:8](src/store/messageStore.test.ts#L8) |
| `ModelRef.modelID` missing | 2 | [ChatPane.tsx:440](src/features/chat/ChatPane.tsx#L440), [messageStoreHooks.test.tsx:35](src/store/messageStoreHooks.test.tsx#L35) |
| `roots` not in `SessionListInput` | 3 | [SessionContext.tsx:70](src/contexts/SessionContext.tsx#L70), [SearchResults.tsx:121](src/features/chat/sidebar/SearchResults.tsx#L121), [useSessions.ts:138](src/hooks/useSessions.ts#L138) |
| `AgentInfo.permission` → `permissions` | 2 | [InputToolbar.test.tsx:13-14](src/features/chat/input/InputToolbar.test.tsx#L13-L14) |
| `SkillInfo.location` | 1 | [SkillPanel.tsx:166](src/components/SkillPanel.tsx#L166) |
| `SkillListOutput` shape | 1 | [SkillPanel.tsx:43](src/components/SkillPanel.tsx#L43) |
| implicit `any` in part merge | 3 | [useSessionManager.ts:64-67](src/hooks/useSessionManager.ts#L64-L67) |
| test fixtures cast to `SessionInfo` | 5 | [SessionList.test.tsx:37](src/features/sessions/SessionList.test.tsx#L37), [NotificationItem.test.tsx:33](src/features/chat/sidebar/NotificationItem.test.tsx#L33), [useSessions.test.tsx:141-143](src/hooks/useSessions.test.tsx#L141-L143) |

---

## 11. Can the UI be kept unchanged?

### Short answer

**No — not unchanged.** A `{info, parts}` + `Session`-like projection gets you a long way — it removes
roughly **60 of the 85** UI typecheck errors, i.e. everything caused by `Session.directory`/`summary`/
`share`, `info.role`, `info.sessionID`, `ModelRef.modelID`, and tool `state.*`. But **v2 genuinely
deleted concepts the UI renders**, and no projection can conjure them from nothing.

### What the projection layer *can* fix (UI untouched)

| v2 reality | Projection |
| --- | --- |
| `SessionInfo.location.directory` | set `directory = location.directory` |
| no session `summary` | derive from `session.diff()` or set `undefined` |
| no session `share` | set `{url}` from `session.export()`, or `undefined` |
| message `type` discriminant | map to `role` |
| no `sessionID` on messages | inject from the list/event envelope |
| `assistant.model: ModelRef` | flatten `model.id → modelID`, `model.providerID → providerID` |
| `ModelRef.id` | copy to `modelID` |
| `content[]` (text/reasoning/tool) | synthesise `parts[]` and a v1-shaped `info` |
| `SessionMessageUser.files/agents` | relocate to `file`/`agent` parts |
| tool `state.content[]` | join `ToolContent[]` into `state.output` |
| v2 `SessionRevert` | keep `messageID`; drop `files` |
| `McpServer.status` | map `pending → needs_client_registration` if desired (or fix 4 case labels) |
| `permission.action/resources/save` | map back to `permission/patterns/always` |
| `PermissionSource.id` | map to `tool.callID` |
| `form.fields` (choice-only) | map to `questions[]` |

### Unavoidable UI edits

| # | Reason | Unavoidable because | Files |
| --- | --- | --- | --- |
| 1 | **Todo removed from v2** | no source data exists at all | 4 deletes + ~13 edits (see [TODO REMOVAL](#todo-removal)) |
| 2 | **`question.*` → `form.*` for non-choice fields** | `number`/`integer`/`boolean`/`external`/option-less `string` fields have **no** v1 UI representation; `FormAnswer` is an object, not `string[][]` | [InlineQuestion.tsx](src/features/chat/InlineQuestion.tsx), [QuestionDialog.tsx](src/features/chat/QuestionDialog.tsx), [QuestionRenderer.tsx](src/features/message/tools/renderers/QuestionRenderer.tsx), [usePermissionHandler.ts](src/hooks/usePermissionHandler.ts), [api/permission.ts](src/api/permission.ts) — **5** |
| 3 | **Retry/error shape** | v2 has no `ApiError`; `isRetryable` and `statusCode` have no source | [SystemPartViews.tsx](src/features/message/parts/SystemPartViews.tsx), [MessageErrorView.tsx](src/features/message/parts/MessageErrorView.tsx) — **2** |
| 4 | **Parts that v2 never emits** (`step-finish`, `subtask`, `retry`, `compaction`) | must be synthesised from step/compaction **events**, not from listed messages — projection can fake the *shape* but only if the event layer also retains the data | [MessageRenderer.tsx](src/features/message/MessageRenderer.tsx), [StepFinishPartView.tsx](src/features/message/parts/StepFinishPartView.tsx), [SubtaskPartView.tsx](src/features/message/parts/SubtaskPartView.tsx), [chatPageModel.ts](src/features/chat/chatPageModel.ts), [chatAreaVisibility.ts](src/features/chat/chatAreaVisibility.ts), [sessionStatsCompute.ts](src/hooks/sessionStatsCompute.ts) — **6** |
| 5 | **Tool state model changed** (`pending` gone, `output`/`raw` → `content[]`/`input: string`) | ~10 components branch on `'pending'`; only fixable by projection **or** by editing each | 10 sites across [ToolPartView.tsx](src/features/message/parts/ToolPartView.tsx), [MessageRenderer.tsx](src/features/message/MessageRenderer.tsx), [TaskRenderer.tsx](src/features/message/tools/renderers/TaskRenderer.tsx), [BashRenderer.tsx](src/features/message/tools/renderers/BashRenderer.tsx), [DefaultRenderer.tsx](src/features/message/tools/renderers/DefaultRenderer.tsx), [QuestionRenderer.tsx](src/features/message/tools/renderers/QuestionRenderer.tsx), [chatPageModel.ts](src/features/chat/chatPageModel.ts) |
| 6 | **`ModelRef.modelID` → `id`** | UI view model `src/types/message.ts` uses `modelID` and is KEPT, so projection is mandatory at each boundary | **6** files if not projected |
| 7 | **`roots` → `parentID`** | request param, not response-shaped — cannot be projected | [SessionContext.tsx:70](src/contexts/SessionContext.tsx#L70), [SearchResults.tsx:121](src/features/chat/sidebar/SearchResults.tsx#L121), [useSessions.ts:138](src/hooks/useSessions.ts#L138), [api/session.ts:94](src/api/session.ts#L94) — **4** |
| 8 | **`needs_client_registration` removed** | UI switch label has no v2 member | [McpPanel.tsx:493,513,556,584](src/components/McpPanel.tsx#L493) — **1 file** |
| 9 | **Permission `always` → `save`** | semantics differ; auto-approve rule capture needs a product decision | [PermissionDialog.tsx:184-189](src/features/chat/PermissionDialog.tsx#L184-L189), [InlinePermission.tsx:61](src/features/chat/InlinePermission.tsx#L61) — **2** |
| 10 | **Dead code** | `PatchPartView` is exported but never rendered; `snapshot`/`step-start` parts are filtered but never shown | [SystemPartViews.tsx:96-135](src/features/message/parts/SystemPartViews.tsx#L96-L135), [parts/index.ts:7](src/features/message/parts/index.ts#L7) — **2** |

### Unavoidable-edit tally by reason

| Reason | Files to edit/delete |
| --- | --- |
| Todo removed | 17 (4 delete + 13 edit) |
| Question → Form (non-choice) | 5 |
| Retry / error shape | 2 |
| Parts v2 never emits | 6 |
| Tool state model | 7–10 |
| `roots` → `parentID` | 4 |
| MCP status member | 1 |
| Permission `always` → `save` | 2 |
| Dead part code | 2 |
| `ModelRef.modelID` (if not projected) | 6 |
| **Total (deduplicated, approximate)** | **~30 files**, of which **~14 are UI components/hooks** and the rest are API-layer |

### Recommended shape

1. Build the projection in **one place** — extend [src/utils/messageConversion.ts](src/utils/messageConversion.ts)
   (it already tolerates both envelope keys) and add a sibling `sessionConversion.ts` exposing
   `toUiSession(SessionInfo): Session`.
2. Apply the session projection at the **fetch boundary** (`getSessions`, `getSession`, `createSession`,
   `updateSession`, `forkSession`, and the `session.created`/`session.updated` event handlers) so the
   123 `.directory` read sites stay untouched.
3. **Delete todo** outright — it cannot be projected.
4. Plan real UI work for **Form fields** and the **retry/error shape**; those are designs, not mappings.
5. Re-point [src/api/sdk.test.ts:10](src/api/sdk.test.ts#L10) from `@opencode-ai/sdk/v2/client` to
   `@opencode/client/promise`, and **delete the stale `@opencode-ai/sdk/v2` imports from
   `src/types/api/*`** — as long as both surfaces are imported, v1 fields like `share`/`summary`/
   `version`/`Todo`/`question.*` will keep type-checking and the migration will silently stall.
