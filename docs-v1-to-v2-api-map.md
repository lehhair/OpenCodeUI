# OpenCode v1 → v2 API Map

Migration reference for `src/api/*.ts`. Every v2 declaration below was extracted from the
installed `@opencode/client@2.0.21` package with `node node_modules/v2-types.mjs <TypeName>`;
every v1 declaration from `@opencode-ai/sdk@1.16.0`. Nothing here is inferred.

## Sources

| Role | Path |
| --- | --- |
| v2 client surface (250 lines) | `node_modules/@opencode/client/dist/promise/client.d.ts` |
| v2 generated types (~256 KB) | `node_modules/@opencode/client/dist/promise/generated/types.d.ts` |
| v2 shared event stream | `node_modules/@opencode/client/dist/shared-events.d.ts` |
| v2 RPC escape hatch | `node_modules/@opencode/client/dist/promise/rpc.d.ts` |
| v1 SDK, for mapping | `node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts` |
| v1 SDK response shapes | `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts` |

> **Naming trap.** `@opencode-ai/sdk/dist/v2/*` is the **v1 SDK's own v2-preview** path, not
> OpenCode v2. The real v2 client is `@opencode/client`. Both are installed here.

### Reading the generated input types

Most v2 `*Input` types are emitted as a self-referential lookup against an inline struct:

```ts
export type SessionGetInput = {
    readonly sessionID: { readonly sessionID: string; }["sessionID"];
};
```

The literal after the property name is the whole struct; `["prop"]` selects one field.
**Collapsed** lines below give the real shape.

### Repo state at time of writing

The migration is **in progress and currently broken**. `src/api/sdk.ts` already builds a v2
client via `OpenCode.make`, but 18 modules still `import { unwrap } from './sdk'` while
`sdk.ts` **does not export `unwrap`** (grep for `export function unwrap` across `src/` returns
nothing). `npm run typecheck` cannot pass until that is reconciled. The tables below map the
**v1 calls listed in the task**, which are what those stale modules still invoke.

---

## 1. Mapping table

Status legend: **same** (identifier and shape unchanged) · **renamed** · **moved** (different
namespace) · **reshaped** (same operation, different I/O) · **REMOVED**.

### Global / instance / server

| v1 call | v2 equivalent | status | notes |
| --- | --- | --- | --- |
| `sdk.global.health()` | `sdk.server.info()` | reshaped | v1 → `{healthy: true, version: string}`. v2 → `ServerInfo = {version, pid, urls, paths:{tmp}}`. **Has `version`; has NO `healthy`.** Liveness == the promise resolving. Callers reading `health.healthy`/`health.status` must switch to try/catch. |
| `sdk.global.dispose()` | — | REMOVED | No `global` namespace in v2 at all. Nearest concept is `LocationShutdown` (`"location.shutdown"`); `sdk.debug.location.evict({location})` evicts a single loaded location server-side. |
| `sdk.instance.dispose({directory})` | `sdk.location.reload()` | reshaped | `location.reload()` takes **no input** and touches the *current* location only; there is no `{directory}` parameter. Returns `void`. |
| — | `sdk.server.pair()` / `sdk.server.connect(input)` | new | Returns `PairingCode = {code, expires_in}` / `PairingSession`. |
| — | `sdk.location.get({location?})` | new | `LocationPublicInfo = {directory, project:{id, directory, canonical}}`. **This is how the UI derives "current project".** |
| `sdk.event.subscribe()` | `sdk.event.subscribe(options?)` | same-ish | v2 returns `AsyncIterable<V2Event>`. `SharedEvents.SubscribeOptions = {signal?, onActivity?}`. Event **types** all changed (see §3). |

### Config

| v1 call | v2 equivalent | status | notes |
| --- | --- | --- | --- |
| `sdk.global.config.get()` | `sdk.config.get()` | moved + reshaped | Global vs per-directory split is gone: one `config.get` returns every config layer. Returns `Array<ConfigEntry>`, not a flat `Config`. |
| `sdk.config.get({directory})` | `sdk.config.get({location:{directory}})` | reshaped | Same method; input nests `directory` under `location`, output is `Array<ConfigEntry>`. |
| `sdk.global.config.update({config})` | — | REMOVED | **No general config writer exists in v2.** |
| `sdk.config.update({directory, config})` | `sdk.config.update({shell})` | REMOVED (as a general writer) | The only surviving writable field is `shell`. `ConfigUpdateInput = {shell: string \| null}` → `void`. Arbitrary config patch/write must move out of the API layer. |
| `sdk.config.providers({directory})` | `sdk.provider.list({location?})` | moved + reshaped | → `ProviderListOutput = {location, data: ProviderInfo[]}`. Model data is now separate: `sdk.model.list()` → `{location, data: ModelInfo[]}` and `sdk.model.default()` → `{location, data: ModelInfo \| null}`. |
| — | `sdk.config.shells()` | new | `ConfigShellOption[] = {path, name, acceptable}[]`. |
| — | `ConfigUpdated` event (`"config.updated"`) | new | Payload is `data: {}` — a bare invalidation signal; re-fetch to learn what changed. |

**How to get the effective config value.** `ConfigGetOutput` is an array of layers. Entries
with `type: "document"` carry a full `info` object; entries with `type: "directory"` carry
only a `path` and are markers, not values. The effective config is the **deep merge of every
`type: "document"` entry's `info`**, applied in array order (later wins). A `type: "document"`
entry with no `path` is the global/user document. Practical helper:

```ts
const entries = await sdk.config.get()
const effective = entries
  .filter((e): e is Extract<ConfigEntry, { type: 'document' }> => e.type === 'document')
  .reduce((acc, e) => deepMerge(acc, e.info), {})
```

### Project / path

| v1 call | v2 equivalent | status | notes |
| --- | --- | --- | --- |
| `sdk.project.current({directory})` | `sdk.location.get({location:{directory}})` | moved | v2 has **no** "current project" method. Derive it: `LocationPublicInfo.project = {id, directory, canonical}`. |
| `sdk.project.list({directory})` | `sdk.project.list()` | reshaped | **Takes no arguments** — lists all known projects globally. Returns `Project[]` (a **bare array**, not `{location, data}`). |
| `sdk.project.initGit({directory})` | — | REMOVED | No equivalent. Project registration happens implicitly through locations. |
| `sdk.project.update({projectID, ...})` | `sdk.project.update({projectID, canonical?, name?, icon?, commands?})` | same | Returns `Project`. v1's arbitrary extra fields are gone; only those four are writable. |
| `sdk.path.get()` | — | REMOVED | `path` namespace is gone. Directory info comes from `location.get()` / `LocationPublicRef`. |

### Session — lifecycle & queries

| v1 call | v2 equivalent | status | notes |
| --- | --- | --- | --- |
| `sdk.session.status({directory})` | `sdk.session.active()` | renamed + reshaped | Returns `{[sessionID]: SessionActive}`, i.e. **all sessions at once**, where `SessionActive = {type:"running"}`. v1 returned a rich per-session status map. Live updates: `SessionStatusUpdated` (`"session.status"`) + `SessionIdle`. Full `SessionStatus` union (`idle`/`retry`/`busy`) rides on the event, not on `active()`. |
| `sdk.session.list({directory,roots,start,search,limit})` | `sdk.session.list({limit?, order?, search?, parentID?, directory?, project?, subpath?, cursor?})` | reshaped | Returns `SessionsResponse = {data: SessionInfo[], cursor:{previous?, next?}}`, not a bare array. `roots` is gone → use `parentID: null`. `start` is gone → use `cursor`. |
| `sdk.session.get({sessionID,directory})` | `sdk.session.get({sessionID})` | same | `directory` is no longer a parameter (location is implicit/global). Returns `SessionInfo`. |
| `sdk.session.create({directory,title,parentID})` | `sdk.session.create({title?, agent?, model?, location?, metadata?, permissions?})` | reshaped | **`parentID` is NOT an input.** Sub-session creation goes through `session.fork` or is driven by the server. `directory` → `location: {directory}`. |
| `sdk.session.update({sessionID,directory,...})` | `sdk.session.update({sessionID, title?, metadata?, permissions?})` | same | Returns `void`. Only title/metadata/permissions are writable. |
| `sdk.session.delete({sessionID,directory})` | `sdk.session.remove({sessionID})` | renamed | `delete` → `remove` (JS reserved word). Returns `void`. |
| `sdk.session.abort({sessionID,directory})` | `sdk.session.interrupt({sessionID, resume?})` | renamed + reshaped | Returns `SessionInterruptResponse = {interrupted: boolean}`. |
| `sdk.session.children({sessionID,directory})` | `sdk.session.list({parentID: sessionID})` | folded | No `children` method; it is now a filter on `list`. Note the response is enveloped + paginated. |
| `sdk.session.fork({sessionID,directory,messageID})` | `sdk.session.fork({sessionID, before?})` | reshaped | Returns `SessionInfo`. Boundary is explicit: `SessionForkBoundary = {type:"before", messageID} \| {type:"through", messageID}`; the fork request itself only accepts `before`. |
| `sdk.session.summarize({sessionID,directory,providerID,modelID,auto})` | `sdk.session.compact({sessionID, id?, delivery?})` | renamed + reshaped | **No provider/model/auto inputs** — the model is taken from the session. Returns `SessionInboxCompaction`. |
| `sdk.session.messages({sessionID,directory,limit})` | `sdk.message.list({sessionID, limit?, order?, cursor?, type?})` | moved | Off `session` entirely. Returns `SessionMessagesResponse = {data: SessionMessageInfo[], cursor}`. |
| `sdk.session.todo({sessionID,directory})` | — | **REMOVED** | See Q10 / §4. No todo identifier exists anywhere in `@opencode/client`. |
| `sdk.session.diff({sessionID,directory,messageID})` | `sdk.session.diff({sessionID, from?, to?, context?})` | reshaped | Returns `FileDiffInfo[]` (bare array). `messageID` → `from`/`to` message/part ids. |
| `sdk.session.revert({sessionID,directory,messageID,partID})` | `sdk.session.revert.stage({sessionID, messageID, files?})` | moved | Returns `SessionRevert = {messageID, partID?, snapshot?, files?: FileDiffInfo[]}`. |
| `sdk.session.unrevert({sessionID,directory})` | `sdk.session.revert.clear({sessionID})` | moved | "Unrevert" == discard the staged revert. Returns `void`. |
| — | `sdk.session.revert.commit({sessionID})` | new | Third member of the split. |
| `sdk.session.share()` | `sdk.session.export({sessionID, sanitize?})` | renamed + reshaped | Returns `SessionTransferData = {info: SessionInfo, messages: SessionMessageInfo[]}`. There is **no share URL** — the UI must handle the transfer payload itself. `share` survives only as a config value (`"manual" \| "auto" \| "disabled"`) and as a TUI command literal. |
| `sdk.session.unshare()` | `sdk.session.import({info, messages})` | renamed + reshaped | No inverse-share exists; `import` is the inverse *operation*, not a share toggle. |

### Session — driving & new families

| v1 call | v2 equivalent | status | notes |
| --- | --- | --- | --- |
| `sdk.session.prompt({sessionID,directory,parts,model,agent,variant})` | `sdk.session.prompt({sessionID, text, files?, agents?, skills?, metadata?, delivery?, resume?, id?})` | **reshaped (breaking)** | **`parts` is gone.** The input is `{text: string, files?: PromptFileAttachment[], agents?: [], skills?: []}`. Model/agent are no longer prompt inputs — call `session.switchModel` / `session.switchAgent` first (or set them at `session.create`). Returns `SessionInboxUser` (an **enqueued inbox item**), not an assistant response. |
| `sdk.session.promptAsync(...)` | `sdk.session.prompt(...)` | subsumed | v2 `prompt` already enqueues and returns immediately. Branch on `delivery: "steer" \| "queue"` instead. |
| `sdk.session.command(...)` | `sdk.session.command({sessionID, name, text, files?, agents?, skills?, delivery?})` | reshaped | Returns `void`. `parts` → `text` + attachment arrays, same as `prompt`. |
| `sdk.session.shell(...)` | `sdk.session.shell({sessionID, command, id?})` | reshaped | Returns `void`. v1 returned `{info, parts}` and accepted `agent`/`model`/`messageID`; v2 takes only an optional client-side `id`. |
| — | `sdk.session.synthetic/skill/wait/background/context/move/view/environment/generate/log` | new | New verbs the UI may want to adopt. |
| — | `sdk.session.message.get({sessionID, messageID})` | new | v1 `session.message()`; now nested one level deeper. |
| — | `sdk.session.inbox.list/cancel/update` | new | Inspect and manage the delivery queue. |
| — | `sdk.session.instructions.entry.list/put/remove` | new | Per-session instruction entries. |
| — | `sdk.session.active/stats/import/export` | new | `stats` → `SessionStatsInfo` (range/tokens/cost/tools/models). |

### Files, find, VCS

| v1 call | v2 equivalent | status | notes |
| --- | --- | --- | --- |
| `sdk.file.list({path,directory})` | `sdk.file.list({path?, location?})` | reshaped | Returns `{location, data: FileSystemEntry[]}` where `FileSystemEntry = {path, type}` — a **flat list, no `children`, no `name`, no `absolute`, no `ignored`**. The UI must build the tree itself. |
| `sdk.file.read({path,directory})` | `sdk.file.read({path, location?})` | **reshaped (breaking)** | Returns `Uint8Array` (raw bytes). **No `format`/`as`/`encoding` option exists.** Text requires `new TextDecoder().decode(bytes)`. |
| `sdk.file.status({directory})` | `sdk.vcs.status({location?})` | moved + reshaped | Returns `{location, data: VcsFileStatus[]}`. See §2 for the field diff. |
| `sdk.find.files({query,directory,type,limit})` | `sdk.file.find({query, type?, limit?, location?})` | moved + reshaped | `find` namespace is gone. Returns `{location, data: FileSystemEntry[]}` — **objects, not the `string[]` v1 returned**. Map with `data.map(e => e.path)`. |
| `sdk.find.symbols({query,directory})` | — | **REMOVED** | See Q1. |
| `sdk.find.text({pattern,directory})` | — | **REMOVED** | See Q1. |
| — | `sdk.file.write({path, payload: Uint8Array, location?})` | new | → `{location, data: FileSystemWrite}`; `FileSystemWrite = {path}`. |
| `sdk.vcs.get()` | `sdk.vcs.get({location?})` | same | → `{location, data: VcsInfo}`; `VcsInfo = {provider?, branch: {current?, default?}}`. |
| `sdk.vcs.diff(...)` | `sdk.vcs.diff({mode, base?, context?, location?})` | reshaped | `mode` is **required**: `"working" \| "branch" \| "committed"`. Returns `{location, data: FileDiffInfo[]}`. |
| `sdk.vcs.status(...)` | `sdk.vcs.status({location?})` | moved from `file.status` | → `{location, data: VcsFileStatus[]}`. |
| — | `sdk.vcs.base()` / `sdk.vcs.branch.list()` | new | `VcsBase = {name, ref, source: "reflog" \| "default"}`; `VcsBranchList = string[]`. |
| — | `FilesystemChanged` event | new | `"filesystem.changed"` — invalidate file/dir caches from this. |

### Permission

| v1 call | v2 equivalent | status | notes |
| --- | --- | --- | --- |
| `sdk.permission.list({directory})` | `sdk.permission.list({sessionID})` (per-session) **or** `sdk.permission.request.list({location?})` (all sessions) | reshaped | `PermissionListInput` **requires `sessionID`** and returns a bare `PermissionRequest[]`. The location-scoped "all pending" list is `permission.request.list` → `{location, data: PermissionRequest[]}`. |
| `sdk.permission.reply({requestID,directory,reply,message})` | `sdk.permission.reply({sessionID, requestID, decision, message?})` | **reshaped (breaking)** | The field is **`decision`**, not `reply`; value is `"once" \| "always" \| "reject"`. **`sessionID` is now required.** Returns `void`. |
| `sdk.permission.respond({sessionID,permissionID,directory,response})` | — | REMOVED | The per-session respond alias is gone; it collapses into `permission.reply` with `sessionID` + `decision`. |
| — | `sdk.permission.get({sessionID, requestID})` | new | → `PermissionRequest`. |
| — | `sdk.permission.create({sessionID, action, resources, save?, metadata?, source?, agent?})` | new | → `{id, effect: PermissionEffect}`; `PermissionEffect = "allow" \| "deny" \| "ask"`. |
| — | `sdk.permission.saved.list({projectID?})` / `.remove({id})` | new | `PermissionSavedInfo = {id, projectID, action, resource, time:{created, updated}}`. Replaces v1 config-level permission save. |

### Question → Form

| v1 call | v2 equivalent | status | notes |
| --- | --- | --- | --- |
| `sdk.question.list({directory})` | `sdk.form.list({location?})` **or** `sdk.session.form.list({sessionID})` | moved + reshaped | `form.list` → `{location, data: FormInfo[]}` (all sessions). `session.form.list` → `FormInfo[]` (bare, required `sessionID`). |
| `sdk.question.reply({requestID,answers})` | `sdk.session.form.reply({sessionID, formID, answer})` | **reshaped (breaking)** | **`answers: QuestionAnswer[]` array → `answer: {[key: string]: FormValue}` object map**, keyed by field `key`. `requestID` → `formID`, and `sessionID` is required. Returns `void`. |
| `sdk.question.reject({requestID})` | `sdk.session.form.cancel({sessionID, formID, message?})` | renamed + reshaped | Returns `void`. |
| — | `sdk.session.form.create({sessionID, title, fields, id?, metadata?})` / `.get({sessionID, formID})` | new | `get` → `FormDetail` (adds `state`). |

### MCP

| v1 call | v2 equivalent | status | notes |
| --- | --- | --- | --- |
| `sdk.mcp.status()` | `sdk.mcp.list({location?})` | renamed + reshaped | → `{location, data: McpServer[]}`; `McpServer = {name, status, integrationID?}` where status is a 5-member union (`connected`/`pending`/`disabled`/`failed`/`needsAuth`). |
| `sdk.mcp.add(name, config)` | `sdk.mcp.add({server, config, location?})` | reshaped | `name` → `server`. Config is a `local` \| `remote` discriminated union. Returns `void`. |
| `sdk.mcp.connect(name)` | `sdk.mcp.connect({server, location?})` | reshaped | `name` → `server`. |
| `sdk.mcp.disconnect(name)` | `sdk.mcp.disconnect({server, location?})` | reshaped | `name` → `server`. |
| `sdk.mcp.auth.start/remove/callback/authenticate` | `sdk.integration.*` / `sdk.credential.*` | moved | MCP OAuth moved into the integration/credential model: `integration.oauth.connect/status/complete/cancel`, `integration.connect.key`, `credential.list/create/update/activate/remove`. |
| `sdk.experimental.resource.list()` | `sdk.mcp.resource.catalog({location?})` | moved | → `McpResourceCatalog` (`{resources, templates}`). |
| — | `sdk.mcp.remove({server, location?})` | new | Delete an MCP server. |

### PTY / shell

| v1 call | v2 equivalent | status | notes |
| --- | --- | --- | --- |
| `sdk.pty.list({directory})` | `sdk.pty.list({location?})` | reshaped | → `{location, data: Pty[]}`. |
| `sdk.pty.create(...)` | `sdk.pty.create({command?, args?, cwd?, title?, env?, location?})` | same | → `{location, data: Pty}`. Note input is **optional**. |
| `sdk.pty.get(...)` | `sdk.pty.get({ptyID, location?})` | same | → `{location, data: Pty}`. |
| `sdk.pty.update(...)` | `sdk.pty.update({ptyID, title?, size?: {rows, cols}, location?})` | same | → `{location, data: Pty}`. |
| `sdk.pty.remove(...)` | `sdk.pty.remove({ptyID, location?})` | same | Returns `void`. |
| `sdk.pty.shells({directory})` | `sdk.config.shells()` | **moved** | The available-shells list left the PTY namespace. Same shape: `{path, name, acceptable}[]`. |
| — | `sdk.pty.connect.token({ptyID, location?})` | new | Replace `ptyBridge` hand-rolled ws/token logic if applicable. |
| — | `sdk.shell.list/create/get/output/remove` | new | First-class shell sessions: `ShellInfo = {id, status, command, cwd, shell, file, pid?, exit?, signal?, metadata, time}`. |
| — | `sdk.experimental.persistentPty.*` | new | Persistent PTY lifecycle (read/list/create/get/update/snapshot/handoff/connectToken). |

### Worktree

| v1 call | v2 equivalent | status | notes |
| --- | --- | --- | --- |
| `sdk.worktree.list({directory})` | `sdk.worktree.list({projectID})` | reshaped | Now **project-scoped, not directory-scoped**. → `WorktreeList = WorktreeDirectory[]` (bare array); `WorktreeDirectory = {directory, strategy?}`. |
| `sdk.worktree.create({directory, worktreeCreateInput})` | `sdk.worktree.create({projectID, from?, branch?, directory?, name?})` | reshaped | → `WorktreeInfo = {directory}`. |
| `sdk.worktree.remove({directory, worktreeRemoveInput})` | `sdk.worktree.remove({projectID, directory, force})` | reshaped | `force` is **required**. Returns `void`. |
| `sdk.worktree.reset(...)` | `sdk.worktree.refresh({projectID})` | renamed | Returns `void`. |

### Agent / command / skill / tool / LSP / TUI

| v1 call | v2 equivalent | status | notes |
| --- | --- | --- | --- |
| `sdk.app.agents({directory})` / `sdk.agent.list()` | `sdk.agent.list({location?})` | moved + reshaped | Left `app`. → `AgentListOutput = {location, data: AgentInfo[]}`. |
| — | `sdk.agent.get({agentID, location?})` | new | → `{location, data: AgentInfo}`. |
| `sdk.command.list({directory})` | `sdk.command.list({location?})` | reshaped | → `CommandListOutput = {location, data: CommandInfo[]}`. |
| `sdk.app.skills({directory})` / `sdk.skill.list()` | `sdk.skill.list({location?})` | moved + reshaped | Left `app`. → `SkillListOutput = {location, data: SkillInfo[]}`. |
| `sdk.tool.list()` | — | **REMOVED** | No `tool` namespace in v2. Tool schemas are no longer exposed over the API. |
| `sdk.tool.ids()` | — | **REMOVED** | Same. Derive tool names from `SessionMessageAssistantTool.name` seen in the stream, or from the permission-config key list. |
| `sdk.lsp.status()` | — | **REMOVED** | No `lsp` namespace and no LSP status type in v2. Only the `lsp?: boolean \| {...}` **config** key survives. |
| `sdk.formatter.status()` | — | **REMOVED** | Same; only the `formatter?:` config key survives. |
| `sdk.tui.*` (`appendPrompt`, `openHelp`, `openSessions`, `openThemes`, `openModels`, `submitPrompt`, `clearPrompt`, `executeCommand`, `showToast`, `publish`, `controlNext`, `controlResponse`) | — | **REMOVED as methods** | v2 has **no `tui` namespace**. The TUI now *receives* four events instead: `TuiPromptAppend`, `TuiCommandExecute`, `TuiToastShow`, `TuiSessionSelect` (`"tui.*"`). A web UI cannot command a TUI in v2. |
| — | `sdk.plugin.list/check/update` | new | |
| — | `sdk.websearch.providers/query` | new | |
| — | `sdk.migration.v1.status()` | new | Reports v1→v2 migration state. |
| — | `sdk.debug.location.list/evict` | new | List/evict loaded location servers. |

---

## 2. Focused answers to the critical questions

### Q1 — Text search / symbol search

**Symbol search is GONE entirely.** A case-insensitive search for `symbol` across every file
in `node_modules/@opencode/client/dist` returns **zero** matches. There is no symbol type, no
`symbols` method, no symbol event. v1's `find.symbols` (LSP `workspace/symbol`) has no v2
successor.

**Full-text content search is GONE entirely.** `find.text` (ripgrep-style matches with
`line_number`, `absolute_offset`, `submatches`) has no v2 equivalent. The `grep` string
appears nowhere in the v2 client package.

**What replaced `find.files`:** `sdk.file.find` — a *fuzzy path/name* search, not a content
search.

```ts
sdk.file.find({ query, type?: "file" | "directory", limit?, location?: {directory} })
// → { location: LocationPublicRef, data: Array<FileSystemEntry> }
```

v1 `find.files` returned `string[]`; v2 returns `FileSystemEntry[]` (`{path, type}`), so
callers must map `data.map(e => e.path)`.

**`reference.list` is NOT a search endpoint.** It lists *configured references* (the
`references` key in config: git repos and local paths):

```ts
sdk.reference.list({ location?: {directory} })
// → { location, data: Array<ReferenceInfo> }
// ReferenceInfo = { name, path, description?, hidden?, source }
// ReferenceSource = { type:"local", path } | { type:"git", repository, branch? }
```

It returns a static, unordered list. It cannot answer "where is symbol X" or "which files
contain Y".

**Is there any escape hatch?** `sdk.rpc.call(input)` plus `rpc.*` events exist for
plugin-defined RPC ports, but no search method is declared in the shipped types. Treat search
as removed unless a specific RPC definition is supplied at runtime.

### Q2 — File read: text content and patch/diff

`sdk.file.read` returns raw bytes and offers **no format option**:

```ts
export type FileReadInput = { readonly location?: {directory?}; readonly path: string };
export type FileReadOutput = globalThis.Uint8Array;
```

- **Text content:** decode in the UI — `new TextDecoder().decode(bytes)`. Detect binary by
  inspecting for NUL bytes / failed decode; v1's `type: "text" | "binary"` and `mimeType`
  are no longer provided, so MIME sniffing must move client-side.
- **Patch/diff:** there is **no patch on the read response**. Get it from a diff endpoint:

```ts
sdk.vcs.diff({ mode: "working" | "branch" | "committed", base?, context?, location? })
// → { location, data: Array<FileDiffInfo> }

sdk.session.diff({ sessionID, from?, to?, context? })
// → Array<FileDiffInfo>

export type FileDiffInfo = {
    file: string;
    patch: string;      // unified diff text
    additions: number;
    deletions: number;
    status: "added" | "deleted" | "modified";
};
```

v1's structured `patch.hunks[]` (`oldStart`/`oldLines`/`newStart`/`newLines`/`lines`) is gone
— `patch` is now a unified-diff **string**, so the UI must parse it (the repo already depends
on `diff@^8`).

### Q3 — File status

Confirmed: `file.status` is **`vcs.status`** in v2, and the item shape changed.

| v1 `File` (`file.status` → `File[]`) | v2 `VcsFileStatus` (`vcs.status` → `{location, data}`) |
| --- | --- |
| `path: string` | `file: string` |
| `added: number` | `additions: number` |
| `removed: number` | `deletions: number` |
| `status: "added" \| "deleted" \| "modified"` | `status: "added" \| "deleted" \| "modified"` (unchanged) |

Two changes: three of four fields renamed, and the array is wrapped in a
`{location, data}` envelope.

### Q4 — Config

Confirmed. `ConfigGetOutput = Array<ConfigEntry>` with

```ts
export type ConfigEntry =
  | { type: "document"; path?: string; info: { /* the full config schema */ } }
  | { type: "directory"; path: string };
```

**Effective value:** deep-merge the `info` of all `type: "document"` entries in array order
(later wins). `type: "directory"` entries carry no values and are only markers of scanned
directories. See the helper in §1.

**`config.update` exists but is not a general writer.** Its entire input is:

```ts
export type ConfigUpdateInput = { readonly shell: string | null };
export type ConfigUpdateOutput = void;
```

So the only programmatically writable config field in v2 is `shell`. **There is no global
config write** — `global.config.update` does not exist, and `config.update` accepts no
`config` object and no location. Arbitrary config editing (the settings/config editor UI) has
no v2 API path and must be re-planned (file write via `file.write`, or dropped). Read the
current value with `config.get()` and react to the `ConfigUpdated` (`"config.updated"`)
event.

### Q5 — Health / version

v1: `global.health()` → `{ healthy: true; version: string }`.

v2: `sdk.server.info()` →

```ts
export type ServerInfo = {
    version: string;
    pid: number;
    urls: Array<string>;
    paths: { tmp: string };
};
```

**Yes, it has `version`.** It does **not** have `healthy` — a successful call *is* the health
signal, so caller code doing `health.healthy === true` must become a try/catch (or treat
resolution as online). `urls` is new and useful for multi-server UI.

### Q6 — Project

- **`project.list()` takes no arguments** and returns `Project[]` (bare array). v1's
  `{directory}` filter is gone; list is global.
- `project.update({projectID, canonical?, name?, icon?, commands?})` → `Project`.
- **There is no "current project" method.** The UI must derive it:
  `sdk.location.get()` → `LocationPublicInfo = {directory, project: {id, directory, canonical}}`.
- **`initGit` is gone** with no replacement.

### Q7 — Skill / command / agent envelopes

All three are `{ location: LocationPublicRef, data: [...] }`:

```ts
export type LocationPublicRef = { directory: string };

export type AgentListOutput   = { location: LocationPublicRef; data: Array<AgentInfo> };
export type CommandListOutput = { location: LocationPublicRef; data: Array<CommandInfo> };
export type SkillListOutput   = { location: LocationPublicRef; data: Array<SkillInfo> };
```

v1 returned bare arrays. Namespace moves: `app.agents` → `agent.list`; `app.skills` →
`skill.list`; `command.list` keeps its name.

### Q8 — Permission

```ts
export type PermissionListInput  = { readonly sessionID: string };          // REQUIRED
export type PermissionReplyInput = {
    readonly sessionID: string;
    readonly requestID: string;
    readonly decision: "once" | "always" | "reject";                        // not `reply`
    readonly message?: string;
};
```

- `permission.list` is now **per-session and requires `sessionID`**; it returns
  `PermissionRequest[]` (bare). For the v1 "all pending across the location" behaviour use
  `sdk.permission.request.list({ location? })` → `{location, data: PermissionRequest[]}`.
- `permission.reply` uses **`decision`**, not `reply` and not `response`, and needs
  `sessionID`. Returns `void`.
- **`permission.respond` is REMOVED.** The v1 per-session alias collapses into
  `permission.reply`.
- `PermissionRequest` unchanged in spirit: `{id, sessionID, action, resources: string[],
  save?: string[], metadata?, source?, message?}`.

### Q9 — Question → Form

`question.*` is gone; the concept is now a schema-driven **Form**.

| v1 | v2 |
| --- | --- |
| `question.list({directory})` | `form.list({location?})` → `{location, data: FormInfo[]}` |
| `question.list` (per-session) | `session.form.list({sessionID})` → `FormInfo[]` |
| `question.reply({requestID, answers: QuestionAnswer[]})` | `session.form.reply({sessionID, formID, answer: {[key]: FormValue}})` → `void` |
| `question.reject({requestID})` | `session.form.cancel({sessionID, formID, message?})` → `void` |
| — | `session.form.create({sessionID, title, fields, id?, metadata?})` → `FormInfo` |
| — | `session.form.get({sessionID, formID})` → `FormDetail` |

Exact shapes:

```ts
export type FormInfo = {
    id: string;
    sessionID: string;
    title: string;
    metadata?: FormMetadata;          // { [x: string]: JsonValue }
    fields: FormFields;
};

export type FormDetail = FormInfo & { state: FormState };

export type FormFields = [FormField, ...Array<FormField>];   // non-empty tuple

export type FormField =
    | FormStringField | FormNumberField | FormIntegerField
    | FormBooleanField | FormMultiselectField | FormExternalField;

export type FormValue  = string | number | "Infinity" | "-Infinity" | "NaN" | boolean | Array<string>;
export type FormAnswer = { [x: string]: FormValue };          // keyed by FormField.key

export type FormState =
    | { status: "pending" }
    | { status: "answered";  answer: FormAnswer }
    | { status: "cancelled"; message?: string };

export type FormMetadata = { [x: string]: JsonValue };
export type FormOption   = { value: string; label: string; description?: string };
export type FormWhen     = { key: string; op: "eq" | "neq"; value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean };

export type FormStringField = {
    key: string; title?: string; description?: string; required?: boolean; hidden?: boolean;
    when?: Array<FormWhen>;
    type: "string";
    format?: "email" | "uri" | "date" | "date-time";
    minLength?: number; maxLength?: number; pattern?: string; placeholder?: string;
    default?: string; options?: Array<FormOption>; custom?: boolean;
};

export type FormNumberField = {
    key: string; title?: string; description?: string; required?: boolean; hidden?: boolean;
    when?: Array<FormWhen>;
    type: "number";
    minimum?: number | "Infinity" | "-Infinity" | "NaN";
    maximum?: number | "Infinity" | "-Infinity" | "NaN";
    default?: number | "Infinity" | "-Infinity" | "NaN";
};

export type FormIntegerField = { /* identical to FormNumberField but */ type: "integer" };

export type FormBooleanField = {
    key: string; title?: string; description?: string; required?: boolean; hidden?: boolean;
    when?: Array<FormWhen>;
    type: "boolean";
    default?: boolean;
};

export type FormMultiselectField = {
    key: string; title?: string; description?: string; required?: boolean; hidden?: boolean;
    when?: Array<FormWhen>;
    type: "multiselect";
    options: Array<FormOption>;
    minItems?: number; maxItems?: number; custom?: boolean; default?: Array<string>;
};

export type FormExternalField = {
    key: string; title?: string; description?: string;
    type: "external"; url: string;
};
```

**Two breaking differences beyond the rename:**

1. **`answers: QuestionAnswer[]` (array) → `answer: FormAnswer` (object map keyed by field
   `key`).** A positional answer array cannot be mechanically translated.
2. **The data model is different in kind.** v1 questions were `{question, header,
   options[{label, description}], multiple}` — a flat choice prompt. v2 forms are a
   JSON-Schema-like *field list* with per-field types, validation constraints
   (`minLength`/`pattern`/`minimum`/`maxItems`), `required`, `hidden`, and conditional
   visibility via `when: [{key, op, value}]`. The question dialog must be rewritten as a
   form renderer, including `when` evaluation and an `external` field type (a URL to open
   out-of-band) that has no v1 analogue. Field keys arrive as `key`, not `id`.

### Q10 — Todo

**Fully removed.** The strings `todo`, `Todo`, and `TODO` do not appear anywhere in
`node_modules/@opencode/client/dist` (types, client, or the `V2Event` union). There is no
`session.todo`, no `Todo` type, and no `todo.updated` event. `session.todo()` is not renamed
or moved — it is deleted.

**Where todo data can still be obtained:** only **client-side, by parsing the tool call**.
The `todowrite` tool name survives in the ecosystem only as a *v1 permission-config key*
(`@opencode-ai/sdk` v1 `PermissionConfig.todowrite?: PermissionActionConfig`); it is not in
the v2 client types or the v2 config schema. So:

- Read `SessionMessageAssistantTool` entries where `name === "todowrite"` and
  `state.status === "completed"`, then take `state.input` (the todo array as the model wrote
  it) and/or `state.metadata`.
- Live updates arrive through the generic tool stream: `SessionToolInputStarted` →
  `SessionToolInputDelta`* → `SessionToolInputEnded` → `SessionToolCalled` →
  `SessionToolSuccess`, plus `SessionMessageContentUpdated` snapshots.
- There is **no dedicated todo event**, so the current `TODO_UPDATED` handler in
  `src/api/events.ts` has nothing to subscribe to.

Treat the todo panel as a **derived view over the message stream**, not an API read.

### LSP / formatter / tool / share / TUI (also removed)

- **`lsp.status()` and `formatter.status()`:** no `lsp` or `formatter` namespace in v2. Only
  the config keys `lsp?` and `formatter?` remain (both `boolean | {[name]: {...}}`). No
  runtime status endpoint.
- **`tool.ids()` / `tool.list()`:** no `tool` namespace. Tool schemas are not exposed.
- **`session.share()` / `session.unshare()`:** replaced by `session.export` / `session.import`
  (see §1). There is no share URL anymore.
- **`tui.*`:** no namespace; only inbound `TuiPromptAppend` / `TuiCommandExecute` /
  `TuiToastShow` / `TuiSessionSelect` events.

---

## 3. SHAPES — exact v2 declarations referenced above

### Envelopes and locations

```ts
export type LocationPublicRef = { directory: string };
export type LocationRef       = { directory: string; workspaceID?: string };

export type LocationGetInput = { readonly location?: { directory?: string } };
export type LocationPublicInfo = {
    directory: string;
    project: { id: string; directory: string; canonical: string };
};
```

### Config

```ts
export type ConfigGetInput   = { readonly location?: { directory?: string } };
export type ConfigGetOutput  = Array<ConfigEntry>;
export type ConfigUpdateInput = { readonly shell: string | null };
export type ConfigUpdateOutput = void;
export type ConfigShellsOutput = Array<ConfigShellOption>;
export type ConfigShellOption = { path: string; name: string; acceptable: boolean };

export type ConfigEntry =
    | { type: "document"; path?: string; info: { /* full config schema */ } }
    | { type: "directory"; path: string };
```

`ConfigEntry.info` is the complete config schema. Its top-level keys (verbatim) are:
`$schema`, `shell`, `model`, `default_agent`, `update`, `share`, `enterprise`, `username`,
`permissions`, `agents`, `snapshots`, `watcher`, `formatter`, `lsp`, `media`, `tool_output`,
`mcp`, `compaction`, `skills`, `commands`, `instructions`, `references`, `websearch`,
`plugins`, `worktree`, `warming`, `providers`, `experimental`. Notable value shapes:

```ts
model?: string | { providerID: string; model: string; variant?: string };
share?: "manual" | "auto" | "disabled";
update?: "disable" | "notify" | "auto";
permissions?: PermissionRuleset;
worktree?: ConfigWorktree;
```

### Server / health

```ts
export type ServerInfo = {
    version: string;
    pid: number;
    urls: Array<string>;
    paths: { tmp: string };
};
export type PairingCode = { code: string; expires_in: number };
```

### Session

```ts
export type SessionListInput = {
    readonly limit?: number;
    readonly order?: "asc" | "desc";
    readonly search?: string;
    readonly parentID?: string | null;
    readonly directory?: string;
    readonly project?: string;
    readonly subpath?: string;
    readonly cursor?: string;
};

export type SessionsResponse = {
    data: Array<SessionInfo>;
    cursor: { previous?: string | null; next?: string | null };
};

export type SessionInfo = {
    id: string;
    parentID?: string;
    fork?: { sessionID: string; boundary: SessionForkBoundary };
    projectID: string;
    agent?: string;
    model?: ModelRef;
    cost: MoneyUSD;                       // = number
    tokens: TokenUsageInfo;
    outcome?: "succeeded" | "failed" | "interrupted";
    time: { created: number; updated: number; idle?: number; viewed?: number; archived?: number };
    title?: string;
    subpath?: string;
    metadata?: SessionMetadata;
    permissions?: PermissionRuleset;
    revert?: SessionRevert;
    location: LocationPublicRef;
};

export type SessionCreateInput = {
    readonly id?: string | null;
    readonly title?: string | null;
    readonly agent?: string | null;
    readonly model?: { id: string; providerID: string; variant?: string } | null;
    readonly location?: { directory: string } | null;
    readonly metadata?: { [x: string]: JsonValue } | null;
    readonly permissions?: ReadonlyArray<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }> | null;
};

export type SessionUpdateInput = {
    readonly sessionID: string;
    readonly title?: string;
    readonly metadata?: { [x: string]: JsonValue };
    readonly permissions?: ReadonlyArray<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }>;
};

export type SessionGetInput    = { readonly sessionID: string };
export type SessionRemoveInput = { readonly sessionID: string };

export type SessionForkInput = { readonly sessionID: string; readonly before?: string };
export type SessionForkBoundary =
    | { type: "before";  messageID: string }
    | { type: "through"; messageID: string };

export type SessionInterruptInput    = { readonly sessionID: string; readonly resume?: boolean };
export type SessionInterruptResponse = { interrupted: boolean };

export type SessionActive = { type: "running" };
// sdk.session.active(): Promise<{ [sessionID: string]: SessionActive }>

export type SessionStatus =
    | { type: "idle" }
    | { type: "retry"; attempt: number; message: string; next: number;
        action?: { reason: string; provider: string; title: string; message: string; label: string; link?: string } }
    | { type: "busy" };

export type SessionDiffInput = {
    readonly sessionID: string;
    readonly from?: string;
    readonly to?: string;
    readonly context?: number;
};

export type SessionRevertStageInput  = { readonly sessionID: string; readonly messageID: string; readonly files?: boolean };
export type SessionRevertClearInput  = { readonly sessionID: string };
export type SessionRevertCommitInput = { readonly sessionID: string };
export type SessionRevert = {
    messageID: string;
    partID?: string;
    snapshot?: string;
    files?: Array<FileDiffInfo>;
};

export type SessionExportInput = { readonly sessionID: string; readonly sanitize?: boolean };
export type SessionTransferData = { info: SessionInfo; messages: Array<SessionMessageInfo> };

export type SessionCompactInput = {
    readonly sessionID: string;
    readonly id?: string;
    readonly delivery?: "steer" | "queue";
};
export type SessionInboxCompaction = {
    id: string; sessionID: string; time: { created: number };
    type: "compaction"; payload: SessionInboxCompactionPayload; delivery: SessionInboxDelivery;
};
export type SessionInboxDelivery = "steer" | "queue";

export type SessionSwitchAgentInput = { readonly sessionID: string; readonly agent: string };
export type SessionSwitchModelInput = { readonly sessionID: string; readonly model: { id: string; providerID: string; variant?: string } };
export type SessionMoveInput = { readonly sessionID: string; readonly directory: string; readonly delivery?: "steer" | "queue" };

export type SessionShellInput = { readonly sessionID: string; readonly command: string; readonly id?: string };
export type SessionWaitInput  = { readonly sessionID: string };
export type SessionBackgroundInput = { readonly sessionID: string };
export type SessionContextInput    = { readonly sessionID: string };
export type SessionViewInput = { readonly sessionID: string; readonly idle: number };
export type SessionEnvironmentInput = { readonly sessionID: string; readonly variables: { [x: string]: string } };
export type SessionGenerateInput = { readonly sessionID: string; readonly prompt: string };

export type ModelRef = { id: string; providerID: string; variant?: string };
export type TokenUsageInfo = {
    input: number; output: number; reasoning: number;
    cache: { read: number; write: number };
};
export type MoneyUSD = number;
```

### Prompt / messages

```ts
export type SessionPromptInput = {
    readonly sessionID: string;
    readonly id?: string | null;
    readonly text: string;
    readonly files?: ReadonlyArray<{ uri: string; name?: string; description?: string;
        mention?: { start: number; end: number; text: string } }>;
    readonly agents?: ReadonlyArray<{ name: string;
        mention?: { start: number; end: number; text: string } }>;
    readonly skills?: ReadonlyArray<{ id: string;
        mention?: { start: number; end: number; text: string } }>;
    readonly metadata?: { readonly [x: string]: JsonValue };
    readonly delivery?: "steer" | "queue" | null;
    readonly resume?: boolean | null;
};

export type SessionInboxUser = {
    id: string; sessionID: string; time: { created: number };
    type: "user"; payload: SessionInboxUserPayload; delivery: SessionInboxDelivery;
};
export type SessionInboxUserPayload = {
    text: string;
    files?: Array<PromptFileAttachment>;
    agents?: Array<PromptAgentAttachment>;
    skills?: Array<PromptSkillAttachment>;
    metadata?: { [x: string]: JsonValue };
};

export type SessionCommandInput = {
    readonly sessionID: string;
    readonly name: string;
    readonly text: string;
    readonly files?: /* as above */;
    readonly agents?: /* as above */;
    readonly skills?: /* as above */;
    readonly delivery?: "steer" | "queue" | null;
};

export type MessageListInput = {
    readonly sessionID: string;
    readonly limit?: number;
    readonly order?: "asc" | "desc";
    readonly cursor?: string;
    readonly type?: "agent-switched" | "model-switched" | "location-switched" | "user"
        | "synthetic" | "system" | "skill" | "shell" | "assistant" | "compaction";
};

export type SessionMessagesResponse = {
    data: Array<SessionMessageInfo>;
    cursor: { previous?: string | null; next?: string | null };
};

export type SessionMessageInfo =
    | SessionMessageAgentSelected | SessionMessageModelSelected
    | SessionMessageLocationSwitched | SessionMessageUser | SessionMessageSynthetic
    | SessionMessageSystem | SessionMessageSkill | SessionMessageShell
    | SessionMessageAssistant | SessionMessageCompaction | SessionMessageIdle;

export type SessionMessageUser = {
    id: string; metadata?: { [x: string]: JsonValue }; time: { created: number };
    text: string; files?: Array<PromptFileAttachment>;
    agents?: Array<PromptAgentAttachment>; skills?: Array<PromptSkillAttachment>;
    type: "user";
};

export type SessionInboxInfo =
    | SessionInboxUser | SessionInboxSynthetic | SessionInboxCompaction | SessionInboxMove;
```

### Files / VCS

```ts
export type FileReadInput  = { readonly location?: { directory?: string }; readonly path: string };
export type FileReadOutput = globalThis.Uint8Array;

export type FileListInput = { readonly location?: { directory?: string }; readonly path?: string };
export type FileListOutput = { location: LocationPublicRef; data: Array<FileSystemEntry> };

export type FileFindInput = {
    readonly location?: { directory?: string };
    readonly query: string;
    readonly type?: "file" | "directory";
    readonly limit?: number;
};
export type FileFindOutput = { location: LocationPublicRef; data: Array<FileSystemEntry> };

export type FileWriteInput  = { readonly location?: { directory?: string }; readonly path: string; readonly payload: globalThis.Uint8Array };
export type FileWriteOutput = { location: LocationPublicRef; data: FileSystemWrite };

export type FileSystemEntry = { path: string; type: "file" | "directory" };
export type FileSystemWrite = { path: string };

export type VcsGetOutput    = { location: LocationPublicRef; data: VcsInfo };
export type VcsStatusInput  = { readonly location?: { directory?: string } };
export type VcsStatusOutput = { location: LocationPublicRef; data: Array<VcsFileStatus> };
export type VcsDiffInput = {
    readonly location?: { directory?: string };
    readonly mode: "working" | "branch" | "committed";
    readonly base?: string;
    readonly context?: number;
};
export type VcsDiffOutput      = { location: LocationPublicRef; data: Array<FileDiffInfo> };
export type VcsBaseOutput      = { location: LocationPublicRef; data: VcsBase | null };
export type VcsBranchListOutput = { location: LocationPublicRef; data: VcsBranchList };

export type VcsInfo       = { provider?: string; branch: VcsBranch };
export type VcsBranch     = { current?: string; default?: string };
export type VcsFileStatus = {
    file: string; additions: number; deletions: number;
    status: "added" | "deleted" | "modified";
};
export type VcsBase     = { name: string; ref: string; source: "reflog" | "default" };
export type VcsBranchList = Array<string>;

export type FileDiffInfo = {
    file: string;
    patch: string;
    additions: number;
    deletions: number;
    status: "added" | "deleted" | "modified";
};
```

### Permission

```ts
export type PermissionEffect = "allow" | "deny" | "ask";

export type PermissionListInput = {
    readonly sessionID: string;                       // required
};

export type PermissionRequestListInput  = { readonly location?: { directory?: string } };
export type PermissionRequestListOutput = { location: LocationPublicRef; data: Array<PermissionRequest> };

export type PermissionReplyInput = {
    readonly sessionID: string;
    readonly requestID: string;
    readonly decision: "once" | "always" | "reject";
    readonly message?: string;
};

export type PermissionGetInput = {
    readonly sessionID: string;
    readonly requestID: string;
};

export type PermissionRequest = {
    id: string;
    sessionID: string;
    action: string;
    resources: Array<string>;
    save?: Array<string>;
    metadata?: { [x: string]: JsonValue };
    source?: PermissionSource;
    message?: string;
};

export type PermissionCreateInput = {
    readonly sessionID: string;
    readonly id?: string | null;
    readonly action: string;
    readonly resources: ReadonlyArray<string>;
    readonly save?: ReadonlyArray<string>;
    readonly metadata?: { readonly [x: string]: JsonValue };
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string };
    readonly agent?: string | null;
};
// → { id: string; effect: PermissionEffect }

export type PermissionSavedInfo = {
    id: string; projectID: string; action: string; resource: string;
    time: { created: number; updated: number };
};
export type PermissionSavedListInput   = { readonly projectID?: string };
export type PermissionSavedRemoveInput = { readonly id: string };

export type PermissionRuleset = Array<PermissionRule>;
export type PermissionRule = { action: string; resource: string; effect: PermissionEffect };
```

### Form

```ts
export type FormListInput  = { readonly location?: { directory?: string } };
export type FormListOutput = { location: LocationPublicRef; data: Array<FormInfo> };

export type SessionFormListInput   = { readonly sessionID: string };
// → FormInfo[]  (bare array, unlike form.list)

export type SessionFormGetInput    = { readonly sessionID: string; readonly formID: string };
export type SessionFormGetOutput   = FormDetail;

export type SessionFormReplyInput = {
    readonly sessionID: string;
    readonly formID: string;
    readonly answer: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> };
};
export type SessionFormReplyOutput = void;

export type SessionFormCancelInput = {
    readonly sessionID: string;
    readonly formID: string;
    readonly message?: string;
};
export type SessionFormCancelOutput = void;

export type SessionFormCreateOutput = FormInfo;

export type FormInfo = {
    id: string; sessionID: string; title: string;
    metadata?: FormMetadata; fields: FormFields;
};
export type FormDetail = {
    id: string; sessionID: string; title: string;
    metadata?: FormMetadata; fields: FormFields; state: FormState;
};

export type FormFields = [FormField, ...Array<FormField>];
export type FormField =
    | FormStringField | FormNumberField | FormIntegerField
    | FormBooleanField | FormMultiselectField | FormExternalField;

export type FormMetadata = { [x: string]: JsonValue };
export type FormOption   = { value: string; label: string; description?: string };
export type FormWhen     = {
    key: string;
    op: "eq" | "neq";
    value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean;
};

export type FormValue  = string | number | "Infinity" | "-Infinity" | "NaN" | boolean | Array<string>;
export type FormAnswer = { [x: string]: FormValue };

export type FormState =
    | { status: "pending" }
    | { status: "answered";  answer: FormAnswer }
    | { status: "cancelled"; message?: string };

export type FormStringField = {
    key: string; title?: string; description?: string; required?: boolean; hidden?: boolean;
    when?: Array<FormWhen>;
    type: "string";
    format?: "email" | "uri" | "date" | "date-time";
    minLength?: number; maxLength?: number; pattern?: string; placeholder?: string;
    default?: string; options?: Array<FormOption>; custom?: boolean;
};
export type FormNumberField = {
    key: string; title?: string; description?: string; required?: boolean; hidden?: boolean;
    when?: Array<FormWhen>;
    type: "number";
    minimum?: number | "Infinity" | "-Infinity" | "NaN";
    maximum?: number | "Infinity" | "-Infinity" | "NaN";
    default?: number | "Infinity" | "-Infinity" | "NaN";
};
export type FormIntegerField = {
    key: string; title?: string; description?: string; required?: boolean; hidden?: boolean;
    when?: Array<FormWhen>;
    type: "integer";
    minimum?: number | "Infinity" | "-Infinity" | "NaN";
    maximum?: number | "Infinity" | "-Infinity" | "NaN";
    default?: number | "Infinity" | "-Infinity" | "NaN";
};
export type FormBooleanField = {
    key: string; title?: string; description?: string; required?: boolean; hidden?: boolean;
    when?: Array<FormWhen>;
    type: "boolean"; default?: boolean;
};
export type FormMultiselectField = {
    key: string; title?: string; description?: string; required?: boolean; hidden?: boolean;
    when?: Array<FormWhen>;
    type: "multiselect";
    options: Array<FormOption>;
    minItems?: number; maxItems?: number; custom?: boolean; default?: Array<string>;
};
export type FormExternalField = {
    key: string; type: "external"; url: string; title?: string; description?: string;
};
```

### Agent / command / skill / project / MCP

```ts
export type AgentListInput  = { readonly location?: { directory?: string } };
export type AgentListOutput = { location: LocationPublicRef; data: Array<AgentInfo> };
export type AgentGetInput   = { readonly agentID: string; readonly location?: { directory?: string } };
export type AgentGetOutput  = { location: LocationPublicRef; data: AgentInfo };

export type AgentInfo = {
    id: string; name: string;
    model?: ModelRef;
    request: ProviderRequest;
    system?: string; description?: string;
    mode: "subagent" | "primary" | "all";
    hidden: boolean;
    color?: string;             // AgentColor = string
    steps?: number;
    permissions: PermissionRuleset;
};

export type CommandListInput  = { readonly location?: { directory?: string } };
export type CommandListOutput = { location: LocationPublicRef; data: Array<CommandInfo> };
export type CommandInfo = { name: string; description?: string };

export type SkillListInput  = { readonly location?: { directory?: string } };
export type SkillListOutput = { location: LocationPublicRef; data: Array<SkillInfo> };
export type SkillInfo = {
    id: string; name: string; description?: string;
    autoinvoke?: boolean; path: string; content: string;
};

export type ProjectListOutput = Array<Project>;      // bare array, no args
export type ProjectUpdateInput = {
    readonly projectID: string;
    readonly canonical?: string;
    readonly name?: string;
    readonly icon?: { url?: string; override?: string; color?: string };
    readonly commands?: { start?: string };
};
export type ProjectUpdateOutput = Project;

export type Project = {
    id: string; canonical: string;
    vcs?: ProjectVcs;                     // ProjectVcs = string
    name?: string;
    icon?: ProjectIcon;
    commands?: ProjectCommands;
    time: ProjectTime;
    sandboxes: Array<string>;
};
export type ProjectIcon     = { url?: string; override?: string; color?: string };
export type ProjectCommands = { start?: string };
export type ProjectTime     = { created: number; updated: number; active: number };

export type ReferenceListInput  = { readonly location?: { directory?: string } };
export type ReferenceListOutput = { location: LocationPublicRef; data: Array<ReferenceInfo> };
export type ReferenceInfo = {
    name: string; path: string; description?: string; hidden?: boolean; source: ReferenceSource;
};
export type ReferenceSource =
    | { type: "local"; path: string }
    | { type: "git"; repository: string; branch?: string };

export type McpListInput  = { readonly location?: { directory?: string } };
export type McpListOutput = { location: LocationPublicRef; data: Array<McpServer> };
export type McpServer = {
    name: string;
    status: McpStatusConnected | McpStatusPending | McpStatusDisabled | McpStatusFailed | McpStatusNeedsAuth;
    integrationID?: string;
};
export type McpStatusConnected = { status: "connected" };
export type McpStatusFailed    = { status: "failed"; error: string };

export type McpAddInput        = { readonly server: string; readonly location?: { directory?: string }; readonly config: /* local | remote union */ };
export type McpConnectInput    = { readonly server: string; readonly location?: { directory?: string } };
export type McpDisconnectInput = { readonly server: string; readonly location?: { directory?: string } };
export type McpRemoveInput     = { readonly server: string; readonly location?: { directory?: string } };
```

### PTY / shell / worktree

```ts
export type PtyListInput   = { readonly location?: { directory?: string } };
export type PtyListOutput  = { location: LocationPublicRef; data: Array<Pty> };
export type PtyCreateInput = {
    readonly location?: { directory?: string };
    readonly command?: string;
    readonly args?: ReadonlyArray<string>;
    readonly cwd?: string;
    readonly title?: string;
    readonly env?: { readonly [x: string]: string };
};
export type PtyCreateOutput = { location: LocationPublicRef; data: Pty };
export type PtyGetInput     = { readonly ptyID: string; readonly location?: { directory?: string } };
export type PtyGetOutput    = { location: LocationPublicRef; data: Pty };
export type PtyUpdateInput  = {
    readonly ptyID: string;
    readonly location?: { directory?: string };
    readonly title?: string;
    readonly size?: { readonly rows: number; readonly cols: number };
};
export type PtyUpdateOutput = { location: LocationPublicRef; data: Pty };
export type PtyRemoveInput  = { readonly ptyID: string; readonly location?: { directory?: string } };

export type Pty = {
    id: string; title: string; command: string; args: Array<string>; cwd: string;
    status: "running" | "exited"; pid: number; exitCode?: number;
};

export type ShellListOutput = { location: LocationPublicRef; data: Array<ShellInfo1> };
export type ShellInfo = {
    id: string; status: "running" | "exited" | "timeout" | "killed";
    command: string; cwd: string; shell: string; file: string;
    pid?: number; exit?: number; signal?: string;
    metadata: { [x: string]: any };
    time: { started: number; completed?: number };
};

export type WorktreeListInput    = { readonly projectID: string };
export type WorktreeList         = Array<WorktreeDirectory>;
export type WorktreeDirectory    = { directory: string; strategy?: string };
export type WorktreeCreateInput  = {
    readonly projectID: string;
    readonly from?: string;
    readonly branch?: string;
    readonly directory?: string;
    readonly name?: string;
};
export type WorktreeInfo         = { directory: string };
export type WorktreeRemoveInput  = { readonly projectID: string; readonly directory: string; readonly force: boolean };
export type WorktreeRefreshInput = { readonly projectID: string };
```

### Model / provider

```ts
export type ModelListInput   = { readonly location?: { directory?: string } };
export type ModelListOutput  = { location: LocationPublicRef; data: Array<ModelInfo> };
export type ModelDefaultInput  = { readonly location?: { directory?: string } };
export type ModelDefaultOutput = { location: LocationPublicRef; data: ModelInfo | null };

export type ModelInfo = {
    id: string; modelID: string; providerID: string;
    canonical?: string; family?: string; name: string;
    compatibility?: ModelCompatibility;
    package?: string; settings?: ModelSettings;
    headers?: { [x: string]: string };
    body?: { [x: string]: any };
    capabilities: ModelCapabilities;
    variants: Array<ModelVariant>;
    time: { released: number };
    cost: Array<ModelCost>;
    status: "alpha" | "beta" | "deprecated" | "active";
    enabled: boolean;
    limit: { context: number; input?: number; output: number };
};

export type ProviderListInput  = { readonly location?: { directory?: string } };
export type ProviderListOutput = { location: LocationPublicRef; data: Array<ProviderInfo> };
export type ProviderGetInput   = { readonly providerID: string; readonly location?: { directory?: string } };
export type ProviderGetOutput  = { location: LocationPublicRef; data: ProviderInfo };
export type ProviderInfo = {
    id: string; canonical?: string; integrationID?: string; name: string;
    activation: "auto" | "enabled" | "disabled";
    package: string;
    settings?: ProviderSettings;
    headers?: { [x: string]: string };
    body?: { [x: string]: any };
};
```

### TUI events (the only surviving TUI surface)

```ts
export type TuiPromptAppend = {
    id: string; created: number; metadata?: { [x: string]: any };
    type: "tui.prompt.append"; location?: LocationRef;
    data: { text: string };
};
export type TuiCommandExecute = {
    id: string; created: number; metadata?: { [x: string]: any };
    type: "tui.command.execute"; location?: LocationRef;
    data: { command: "session.list" | "session.new" | "session.share" | "session.interrupt"
        | "session.background" | "session.compact" | "session.page.up" | "session.page.down"
        | "session.line.up" | "session.line.down" | "session.half.page.up" | "session.half.page.down"
        | "session.first" | "session.last" | "prompt.clear" | "prompt.submit"
        | "agent.cycle" | (string & {}) };
};
export type TuiToastShow = {
    id: string; created: number; metadata?: { [x: string]: any };
    type: "tui.toast.show"; location?: LocationRef;
    data: { title?: string; message: string; variant: "info" | "success" | "warning" | "error"; duration?: number };
};
export type TuiSessionSelect = {
    id: string; created: number; metadata?: { [x: string]: any };
    type: "tui.session.select"; location?: LocationRef;
    data: { sessionID: string };
};
```

### Events

```ts
export type EventSubscribeOutput = V2Event;
export type V2Event = /* 80+ members, including: */
    | LocationShutdown | ConfigUpdated | SessionCreated | SessionRenamed
    | SessionDeleted | SessionForked | SessionStatusUpdated | SessionIdle
    | SessionInboxDelivered | SessionInboxEnqueued | SessionInboxCancelled
    | SessionExecutionStarted | SessionExecutionSucceeded | SessionExecutionFailed
    | SessionExecutionInterrupted | SessionTextStarted | SessionTextDelta | SessionTextEnded
    | SessionReasoningStarted | SessionReasoningDelta | SessionReasoningEnded
    | SessionToolInputStarted | SessionToolInputDelta | SessionToolInputEnded
    | SessionToolCalled | SessionToolProgress | SessionToolSuccess | SessionToolFailed
    | SessionStepStarted | SessionStepStreamed | SessionStepEnded | SessionStepFailed
    | SessionRetryScheduled | SessionCompactionStarted | SessionCompactionDelta
    | SessionCompactionEnded | SessionCompactionFailed
    | SessionRevertStaged | SessionRevertCleared | SessionRevertCommitted
    | SessionMessageContentUpdated | SessionSynthetic | SessionSkillActivated
    | SessionShellStarted | SessionShellEnded | SessionInstructionsUpdated
    | FilesystemChanged | ReferenceUpdated | PermissionAsked | PermissionReplied
    | FormCreated | FormReplied | FormCancelled
    | ProjectUpdated | WorktreeUpdated | WorktreeResolved | CommandUpdated
    | SkillUpdated | PtyCreated | PtyUpdated | PtyExited | PtyDeleted
    | ShellCreated | ShellExited | ShellDeleted | McpStatusChanged | McpResourcesChanged
    | VcsBranchUpdated | PluginUpdated | ProviderUpdated | ModelUpdated | AgentUpdated
    | CredentialUpdated | CredentialSwitched | IntegrationUpdated | InstallationUpdated
    | InstallationUpdateAvailable | ModelsDevRefreshed | WebsearchUpdated
    | TuiPromptAppend | TuiCommandExecute | TuiToastShow | TuiSessionSelect
    | V2EventRpc | V2EventServerConnected;

export type LocationShutdown = {
    id: string; created: number; metadata?: { [x: string]: any };
    type: "location.shutdown"; location?: LocationRef; data: {};
};
export type ConfigUpdated = {
    id: string; created: number; metadata?: { [x: string]: any };
    type: "config.updated"; location?: LocationRef; data: {};
};
export type SessionStatusUpdated = {
    id: string; created: number; metadata?: { [x: string]: any };
    type: "session.status"; location?: LocationRef;
    data: { sessionID: string; status: SessionStatus };
};
export type SessionIdle = {
    id: string; created: number; metadata?: { [x: string]: any };
    type: "session.idle"; location?: LocationRef;
    data: { sessionID: string };
};
export type FormCreated = {
    id: string; created: number; metadata?: { [x: string]: any };
    type: "form.created"; location?: LocationRef;
    data: { form: FormInfo1 };
};
export type FormReplied = {
    id: string; created: number; metadata?: { [x: string]: any };
    type: "form.replied"; location?: LocationRef;
    data: { id: string; sessionID: string; answer: FormAnswer2 };
};
```

Note there is **no `todo.*` event** and **no `question.*` event** anywhere in `V2Event`.

---

## 4. UI IMPACT

Features that lose data or must change, given the removals.

### Symbol search — feature is unrecoverable (currently dormant)

`searchSymbols()` in `src/api/file.ts:114` calls `sdk.find.symbols`. In v2 there is **no
symbol search at any layer** (no `Symbol` type, no `SymbolSource`, no `symbols` method —
verified by case-insensitive scan of the whole v2 package). Impact is currently low because
`searchSymbols` has **no UI consumers** — grep for `searchSymbols` finds only its definition.
**Action:** delete the function and the `Symbol`/`SymbolLocation`/`SymbolRange` type aliases
(already stubbed to `never` in `src/types/api/file.ts:72-76`). If a symbol picker is ever
wanted, it cannot be backed by the server and would need a local LSP client. Note also that
v2 removed `lsp.status()`, so the UI cannot even report whether a language server is running.

### Text search — the FileExplorer content panel loses its backend

`src/components/FileExplorer.tsx:327` calls `searchText(...)` (via `src/api/file.ts:122`,
`sdk.find.text`) and renders matches with a dedicated error state
(`fileExplorer.textSearchFailed`). **v2 has no full-text endpoint.** The filename half of the
search survives via `file.find`; the content half does not.

Options, in order of cost:

1. **Drop the content-search panel** and make the search box filename-only
   (`file.find`). Smallest change; deletes a user-visible feature.
2. **Implement client-side search.** Load directory contents with `file.list` and read files
   with `file.read` (decode via `TextDecoder`), then match locally. Only viable over a
   bounded subtree — there is no recursive list call and no `.gitignore`-aware walk, so this
   will be slow and will need its own ignore handling (`FileSystemEntry` dropped v1's
   `ignored` flag, and `watcher.ignore` in config is server-side only).
3. Server-side extension — out of scope for this migration.

Either way, `TextSearchMatch` (already `never` in `src/types/api/file.ts:79`) must be
replaced by whatever local shape is chosen, and the `searchText` facade deleted.

### File search / @-mention — survives with a shape change

Both consumers use the filename search and are salvageable:

- `src/components/FileExplorer.tsx:313` — `searchFiles(query, {directory, limit: 50})`.
- `src/features/mention/MentionMenu.tsx:257` — `searchFiles(query, {limit: 20, directory})`.

`find.files` → `file.find`, but the return changes from `string[]` to
`{location, data: FileSystemEntry[]}`. Update the adapter in `src/api/file.ts:38-56` to
`unwrap`-equivalent (there is no envelope in v2 — return the promise and map
`res.data.map(e => e.path)`). `MentionMenu` also calls `listDirectory` (line 170), which now
returns flat `FileSystemEntry[]` with **no `children`, `name`, `absolute`, or `ignored`** —
the tree/expand logic in `src/components/FileExplorer.tsx:817-819` and
`src/hooks/useFileExplorer.ts` must derive `name` from `path` and build the tree locally.

### File read / diff viewer — must decode bytes and parse unified patches

`src/hooks/useFileExplorer.ts:8` consumes `getFileContent`, `getFileStatus`, `getVcsDiff`,
`getSessionDiff`. In v2:

- `getFileContent` → `Uint8Array`. The viewer must decode text itself and do its own binary
  detection; the old `content` / `diff` / `patch.hunks` / `encoding` / `mimeType` fields are
  all gone. Any code reading `content.type` or `content.diff` breaks.
- `getFileStatus` → `vcs.status`, with `path → file`, `added → additions`,
  `removed → deletions`, and a `{location, data}` envelope. Line 137 and the
  `FileStatusItem` mapping need updating.
- Patches now arrive as `FileDiffInfo.patch` — a **unified diff string**, not structured
  hunks. `src/components/DiffViewer.tsx` / `SessionChangesPanel.tsx` must parse it (the repo
  already depends on `diff@^8`). Local helpers `getFileStatusFromDiff` and `getFileStatus`
  in the two components already derive status from diffs, so they are largely unaffected.

### Todo — the panel must be re-derived from the message stream

`src/store/todoStore.ts` (39 references), `src/api/todo.ts`, `src/api/events.ts`
(`TODO_UPDATED` at line 851, plus `normalizeTodoItems`), `src/api/session.ts`
(`getSessionTodos` at line 286, `sdk.session.todo` at line 289), `src/contexts/SessionContext.tsx`,
and `src/utils/sessionLifecycle.ts` all depend on a todo API that no longer exists.

**There is no replacement endpoint and no todo event.** The only path is client-side
derivation from `todowrite` tool calls in the assistant stream: match
`SessionMessageAssistantTool` with `name === "todowrite"`, `state.status === "completed"`,
and read `state.input` / `state.metadata`. Live updates come from the generic tool events
(`SessionToolCalled` → `SessionToolSuccess`) and `SessionMessageContentUpdated` snapshots
rather than a first-class event.

**Action:** rewrite `todoStore` as a projector over the message stream. `normalizeTodoItems`
can survive as a pure function if the derived objects are shaped like the old `Todo`. The
`TODO_UPDATED` branch in `events.ts:851` must be deleted — that event never fires in v2. This
is the single largest functional rewrite in the migration. Note that `todowrite` as a
permission key exists only in the **v1** SDK types; the v2 `PermissionRuleset` is a generic
`{action, resource, effect}[]` list, so `configEditorPermissions.tsx` should stop depending on
a hard-coded built-in tool list.

### Share — no share URL

`src/features/chat/ShareDialog.tsx:34` reads `updatedSession.share?.url`, and
`src/hooks/useSessionManager.ts:167,209,224` map `sessionInfo?.share?.url`. **`SessionInfo`
has no `share` field in v2**, and `session.share`/`unshare` are gone. The replacement,
`session.export`, returns `SessionTransferData` (`{info, messages}`) — a data payload, not a
URL. The share-URL UI must be removed or reworked to publish/hand off the transfer payload.
The config `share?: "manual" | "auto" | "disabled"` key still exists and is still editable in
`configEditorSections.tsx:67` / validated in `configEditorValidation.ts:30`, so the *setting*
survives even though the *action* does not.

### LSP / formatter status — no runtime status at all

`src/api/lsp.ts` calls `sdk.lsp.status` and `sdk.formatter.status`; patch
`src/api/lsp.ts:5` imports v1 SDK types. Both endpoints are **removed**, and no status type
exists in v2. The exports `getLspStatus` / `getFormatterStatus` currently have **no UI
consumers** (grep finds only the definitions), so impact is limited to deleting the module.
If a status indicator is desired it cannot be backed by the API.

### Question → Form — the dialog must be rewritten as a form renderer

`src/hooks/usePermissionHandler.ts` (12 references), `src/hooks/useChatSession.ts` (10),
`src/hooks/useGlobalEvents.ts` (6), `src/api/permission.ts:74-118`, and
`src/store/notificationEventSettingsStore.ts` consume `question.list/reply/reject`.

Two independent breaks:

1. **Reply payload shape.** v1 sent `answers: QuestionAnswer[]` (a positional array); v2
   sends `answer: {[fieldKey]: FormValue}` (an object map) plus `sessionID` and `formID`.
   `reject` → `cancel` with an optional `message`.
2. **Rendering model.** v1 questions were `{question, header, options[], multiple}`. v2 forms
   are a JSON-Schema-like field list: `FormFields` (non-empty tuple) of
   `string | number | integer | boolean | multiselect | external` fields with `required`,
   `hidden`, validation constraints, and `when: [{key, op, value}]` conditional visibility.
   The existing question dialog cannot be adapted mechanically — it needs a field renderer
   with `when` evaluation and a handler for the `external` field type (open a URL) that has
   no v1 counterpart.

`FormState` also gives the UI something v1 lacked: `get` returns whether the form is still
`pending`, already `answered`, or `cancelled`. Subscribe to `FormCreated` / `FormReplied` /
`FormCancelled` instead of the removed `question.*` events.

### Permission reply — field rename plus required `sessionID`

`src/api/permission.ts:33-65` sends `reply` and, when a session is known, uses the removed
`sdk.permission.respond` with `permissionID` + `response`. In v2 there is a **single**
`permission.reply` taking `{sessionID, requestID, decision, message?}` where `decision` is
`"once" | "always" | "reject"`. The whole dual-branch (`respond` vs `reply`) structure
collapses to one call, and every caller's `reply` field must be renamed to `decision`.
Also, `permission.list` now requires `sessionID`; the location-wide list moved to
`permission.request.list`.

### Tool list / TUI / global lifecycle — smaller removals

- **`sdk.tool.ids()` / `sdk.tool.list()`** (`src/api/tool.ts`) — removed. Anything showing a
  tool inventory must derive names from observed `SessionMessageAssistantTool.name` values or
  the permission-config keys.
- **`sdk.tui.*`** — removed as methods; only inbound `tui.*` events remain. If the web UI
  ever drove a TUI, that capability is gone.
- **`sdk.global.health()`** (`src/api/global.ts:14`) — switch to `server.info()`. Callers
  reading `health.healthy` or `health.status` (e.g. `src/store/serverStore.ts:707`, which
  validates `data.healthy === true`) must treat a resolved `server.info()` as healthy.
  `health.version` is safe — `ServerInfo.version` exists.
- **`sdk.global.dispose()` / `sdk.instance.dispose({directory})`** — no direct replacement;
  use `location.reload()` for the current location.
- **`sdk.project.current()` / `initGit`** (`src/api/client.ts:118,134`) — gone; derive the
  current project from `location.get().project`, and drop the git-init affordance.
- **`sdk.path.get()`** (`src/api/client.ts:164`) — gone; take the directory from
  `location.get()`.
- **Config write** (`src/api/config.ts:29,38`) — the general config writer is gone; only
  `{shell}` is writable. The settings/config editor that PATCHes arbitrary config must be
  re-planned (likely `file.write` to the config document, or read-only).

### Cross-cutting: the migration is currently non-compiling

`unwrap` is imported by 18 modules from `./sdk` but is **not defined or exported** there.
Since the v2 promise client rejects on error instead of returning `{data, error}`, the fix is
to drop `unwrap` entirely (return the promise, and map the `{location, data}` envelopes where
they exist). Note that envelopes are **not** universal: `session.list`, `message.list`,
`file.list`, `file.find`, `agent.list`, `command.list`, `skill.list`, `provider.list`,
`model.list`, `mcp.list`, `pty.*`, `vcs.*`, `worktree.list`, `form.list`,
`permission.request.list` use `{location, data}`; but `session.get/create/fork`, `session.diff`,
`session.form.list`, `permission.list`, and `project.list` return bare values. Assume nothing
per call site.
