import { describe, expect, it } from 'vitest'
import type { ToolViewPart } from './types'
import { defaultExtractData } from './registry'

describe('defaultExtractData', () => {
  it('extracts files and diagnostics from metadata', () => {
    const part: ToolViewPart = {
      type: 'tool',
      id: 'tool-1',
      name: 'read',
      messageID: 'message-1',
      time: { created: 1, completed: 2 },
      state: {
        status: 'completed',
        input: { filePath: 'src/app.ts' },
        content: [{ type: 'text', text: 'file body' }],
        metadata: {
          files: [
            {
              filePath: 'src/app.ts',
              diff: '@@ -1 +1 @@',
              additions: 1,
              deletions: 1,
            },
          ],
          diagnostics: {
            'src/app.ts': [
              {
                severity: 1,
                message: 'Syntax error',
                range: { start: { line: 3, character: 5 } },
              },
            ],
          },
        },
      },
    }

    const extracted = defaultExtractData(part)

    expect(extracted.files).toEqual([expect.objectContaining({ filePath: 'src/app.ts', additions: 1, deletions: 1 })])
    expect(extracted.diagnostics).toEqual([
      expect.objectContaining({ file: 'app.ts', severity: 'error', line: 3, column: 5 }),
    ])
  })

  it('reads completed output from the native content array', () => {
    const part: ToolViewPart = {
      type: 'tool',
      id: 'tool-2',
      name: 'bash',
      messageID: 'message-1',
      time: { created: 1, completed: 2 },
      state: {
        status: 'completed',
        input: { command: 'ls' },
        content: [
          { type: 'text', text: 'a.txt' },
          { type: 'file', uri: 'file:///workspace/a.txt', mime: 'text/plain', name: 'a.txt' },
        ],
        metadata: { exit: 0 },
      },
    }

    const extracted = defaultExtractData(part)

    expect(extracted.output).toBe('a.txt')
    expect(extracted.toolFiles).toEqual([{ uri: 'file:///workspace/a.txt', mime: 'text/plain', name: 'a.txt' }])
    expect(extracted.failed).toBe(false)
  })

  it('treats a completed shell tool with a non-zero exit as failed', () => {
    const part: ToolViewPart = {
      type: 'tool',
      id: 'tool-3',
      name: 'shell',
      messageID: 'message-1',
      time: { created: 1, completed: 2 },
      state: {
        status: 'completed',
        input: { command: 'false' },
        content: [{ type: 'text', text: '' }],
        metadata: { exit: 1 },
      },
    }

    expect(defaultExtractData(part).failed).toBe(true)
  })

  it('reads the structured error message verbatim', () => {
    const part: ToolViewPart = {
      type: 'tool',
      id: 'tool-4',
      name: 'read',
      messageID: 'message-1',
      time: { created: 1, completed: 2 },
      state: {
        status: 'error',
        input: { filePath: 'missing.ts' },
        error: { type: 'not_found', message: 'no such file', status: 404 },
      },
    }

    const extracted = defaultExtractData(part)

    expect(extracted.error).toBe('no such file')
    expect(extracted.failed).toBe(true)
  })
})
