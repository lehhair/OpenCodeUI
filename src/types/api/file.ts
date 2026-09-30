// ============================================
// 文件相关内部类型（OpenCode V2 形状）
// ============================================
//
// ⚠️ **阶段 3b**：本文件原先从 `./v1Model` 转发 5 个 V1 类型，现已全部改为
// **就地重定义**（`v1Model.ts` 的 B 桶收敛的一部分）。原因分三类：
//
//   1. `Symbol` / `SymbolRange` / `SymbolLocation` / `TextSearchMatch` / `FindTextResponse`
//      → **功能已删除**：V2 不再运行语言服务器（`GET /find/symbol` 已删），
//        内容搜索 `GET /find` 也没有对应端点。**这些类型直接删掉，不再重定义。**
//   2. `FilePatch` / `PatchHunk`
//      → 只被 `FileContent.patch` 用；而 V2 的 `fs/read` **只返回原始字节**，
//        不产出 diff/patch → 一并删掉。
//   3. `FileNode` / `FileContent` / `FileStatusItem`（原名 `File`）
//      → 仍是下游真实消费的形状（`FileExplorer` / `useFileExplorer`），
//        就地按 V2 能提供的数据重定义（**关键差别：`FileNode` 不再有 `ignored`**）。
//
// 与 `v1Model.ts` 的关系：本文件**不再引用 `v1Model` 的任何导出**。
// ============================================

/**
 * 目录/文件条目（`GET /api/fs/list` 的返回经 API 层补全后的形状）
 *
 * V2 的 `FileSystemEntry` 只给 `{ path, type }`，其余字段都是**前端补的**：
 *   - `name`     ← `path` 最后一段（剥掉目录的尾斜杠）
 *   - `absolute` ← location 目录 + `/` + path
 *
 * ⛔ **阶段 3b 删除了 `ignored` 字段**（V1 有、V2 没有）：
 *   V1 用 `ignored: true` 把 gitignore 命中的条目灰显（`opacity-50`）；
 *   V2 的 `fs/list` **不返回任何 ignored 标记**，而且会**原样列出** gitignore 命中的条目
 *   （`.gitignore`、`.git/`、被忽略的目录都在列表里）。
 *   → 决策（KISS，见阶段 3b 报告任务 E-4）：**接受能力丢失**，把灰显逻辑删干净，
 *     不自己实现 gitignore 解析（前端解析 .gitignore 的规则复杂度远高于收益）。
 */
export type FileNode = {
  name: string
  path: string
  absolute: string
  type: 'file' | 'directory'
}

export type FileNodeType = FileNode['type']

/**
 * 文件内容（`GET /api/fs/read/*` 的返回经 API 层归一后的形状）
 *
 * V2 的 `fs/read` 返回**裸 `Uint8Array`**（丢掉 content-type），
 * 所以「文本 or 二进制」「mimeType」「要不要 base64」全部由前端判断（见 `src/api/file.ts`）：
 *   - 文本   → `{ type: 'text',   content: 解码后的字符串, mimeType }`
 *   - 二进制 → `{ type: 'binary', content: base64, encoding: 'base64', mimeType }`
 *
 * ⛔ 阶段 3b 删除了 V1 的 `diff` / `patch` 两个可选字段：
 *   V2 的 `fs/read` 只给原始字节，改动内容要另走 `/api/vcs/diff`；
 *   下游对这两个字段本来就只做可选判断（且预览分支早已注释掉）。
 */
export type FileContent = {
  type: 'text' | 'binary'
  content: string
  encoding?: 'base64'
  mimeType?: string
}

/**
 * 单个文件的改动状态（`GET /api/vcs/status` 的返回经 API 层映射后的形状）
 *
 * V2 的字段是 `{ file, additions, deletions, status }`，
 * 内部形状把 `file` 叫 `path`（V1 的命名）。
 */
export type FileStatusItem = {
  path: string
  added: number
  removed: number
  status: 'added' | 'deleted' | 'modified'
}

/**
 * 单文件 diff 的基础形状
 *
 * ⚠️ 阶段 2b：原先引用 `v1Model.SnapshotFileDiff`（C 桶，已随事件层删除）。
 * 这里**就地定义等价形状**（结构一字未改，`file` / `patch` / `status` 仍是可选）——
 * V2 的 `FileDiffInfo` 与它字段完全一致（只是 V2 的 `file` / `patch` 为必填），
 * 所以 `sdk.session.diff()` 的返回值可以直接传进来。
 */
interface SnapshotFileDiffShape {
  file?: string
  patch?: string
  additions: number
  deletions: number
  status?: 'added' | 'deleted' | 'modified'
}

export type FileDiff = Omit<SnapshotFileDiffShape, 'file'> & {
  file: string
  before?: string
  after?: string
}

export function normalizeFileDiffs(diffs: SnapshotFileDiffShape[] | undefined): FileDiff[] {
  return (diffs ?? []).filter((diff): diff is FileDiff => typeof diff.file === 'string' && diff.file.length > 0)
}
