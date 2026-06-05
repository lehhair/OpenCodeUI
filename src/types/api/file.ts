import type {
  File as SDKFile,
  FileContent as SDKFileContent,
  FileNode as SDKFileNode,
  SnapshotFileDiff as SDKSnapshotFileDiff,
  Symbol as SDKSymbol,
} from '@opencode-ai/sdk/v2/client'

export type FileNodeType = SDKFileNode['type']

export type FileNode = SDKFileNode

export type FilePatch = NonNullable<SDKFileContent['patch']>

export type PatchHunk = FilePatch['hunks'][number]

export type FileContent = SDKFileContent

export type FileStatusItem = SDKFile

export type FileDiff = Omit<SDKSnapshotFileDiff, 'file'> & {
  file: string
  before?: string
  after?: string
}

export function normalizeFileDiffs(diffs: SDKSnapshotFileDiff[] | undefined): FileDiff[] {
  return (diffs ?? []).filter(
    (diff): diff is FileDiff => typeof diff.file === 'string' && diff.file.length > 0,
  )
}

export type SymbolRange = SDKSymbol['location']['range']

export type SymbolLocation = SDKSymbol['location']

export type Symbol = SDKSymbol
