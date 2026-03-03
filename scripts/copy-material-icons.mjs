/**
 * Copy only the material-icon-theme SVGs that are actually referenced
 * by src/utils/materialIcons.ts to public/material-icons/.
 *
 * Runs automatically via postinstall hook.
 */

import { copyFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const srcDir = resolve(root, 'node_modules/material-icon-theme/icons')
const destDir = resolve(root, 'public/material-icons')

if (!existsSync(srcDir)) {
  console.warn('[copy-material-icons] Source not found, skipping:', srcDir)
  process.exit(0)
}

// Parse materialIcons.ts to extract every icon name referenced
const tsSource = readFileSync(
  resolve(root, 'src/utils/materialIcons.ts'),
  'utf-8',
)

const icons = new Set()

// Icon values after colon: 'icon-name'
for (const m of tsSource.matchAll(/:\s*'([a-z0-9_-]+)'/g)) {
  icons.add(m[1])
}
// Array items [ext, icon]
for (const m of tsSource.matchAll(/\[\s*'[^']+'\s*,\s*'([a-z0-9_-]+)'\s*\]/g)) {
  icons.add(m[1])
}
// Defaults
icons.add('file')
icons.add('folder')
icons.add('folder-open')

// Folder icons need both base and -open variants
for (const icon of [...icons]) {
  if (icon.startsWith('folder-') && !icon.endsWith('-open')) {
    icons.add(icon + '-open')
  }
}

// Clean destination and copy only needed files
if (existsSync(destDir)) {
  rmSync(destDir, { recursive: true })
}
mkdirSync(destDir, { recursive: true })

let copied = 0
let missing = 0
for (const icon of icons) {
  const srcPath = resolve(srcDir, icon + '.svg')
  const destPath = resolve(destDir, icon + '.svg')
  if (existsSync(srcPath)) {
    copyFileSync(srcPath, destPath)
    copied++
  } else {
    console.warn(`  [WARN] Missing: ${icon}.svg`)
    missing++
  }
}

console.log(
  `[copy-material-icons] Copied ${copied} icons to public/material-icons/` +
    (missing ? ` (${missing} missing)` : ''),
)
