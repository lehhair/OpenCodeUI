// Targeted v1→v2 rewrites for UI files.
// Usage: node scripts/v2-ui-fix.mjs
//
// Each entry lists EXACT literal replacements. Kept in a file (not inline shell)
// because PowerShell flattens nested arrays and mangles quoting.

import { readFileSync, writeFileSync } from 'node:fs'

/** @type {Array<{file: string, replace: Array<[string, string]>}>} */
const EDITS = [
  {
    file: 'src/contexts/SessionContext.tsx',
    replace: [
      ['data[0].directory', 'data[0].location?.directory'],
      ['session.directory', 'session.location?.directory'],
    ],
  },
  {
    file: 'src/features/chat/sidebar/MultiServerFolderList.tsx',
    replace: [['session.directory', 'session.location?.directory']],
  },
  {
    file: 'src/features/chat/sidebar/SearchResults.tsx',
    replace: [['session.directory', 'session.location?.directory']],
  },
  {
    file: 'src/features/chat/sidebar/SessionChildrenSlot.tsx',
    replace: [['parentSession.directory', 'parentSession.location?.directory']],
  },
  {
    file: 'src/features/sessions/SessionList.tsx',
    replace: [['session.directory', 'session.location?.directory']],
  },
  {
    file: 'src/hooks/useGlobalEvents.ts',
    replace: [['session.directory', 'session.location?.directory']],
  },
  {
    file: 'src/hooks/useSessionManager.ts',
    replace: [['sessionInfo?.directory', 'sessionInfo?.location?.directory']],
  },
  {
    file: 'src/hooks/useSessions.ts',
    replace: [
      ['session.directory', 'session.location?.directory'],
      ['data[0].directory', 'data[0].location?.directory'],
    ],
  },
  {
    file: 'src/features/chat/sidebar/SidePanel.tsx',
    replace: [
      ['session.directory', 'session.location?.directory'],
      ['s.directory', 's.location?.directory'],
    ],
  },
  {
    file: 'src/hooks/useChatSession.ts',
    replace: [
      ['newSession.directory', 'newSession.location?.directory'],
      ['forkedSession.directory', 'forkedSession.location?.directory'],
      ['session.directory', 'session.location?.directory'],
      ['target.directory', 'target.location?.directory'],
      ['sessions[0].directory', 'sessions[0].location?.directory'],
    ],
  },
]

let changed = 0
for (const entry of EDITS) {
  const original = readFileSync(entry.file, 'utf8')
  let next = original
  for (const [from, to] of entry.replace) {
    next = next.split(from).join(to)
  }
  if (next !== original) {
    writeFileSync(entry.file, next)
    changed += 1
    console.log(`patched ${entry.file}`)
  } else {
    console.log(`unchanged ${entry.file}`)
  }
}
console.log(`\n${changed} file(s) patched`)
