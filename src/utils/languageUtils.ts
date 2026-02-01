// Language normalization helpers

import { bundledLanguages } from 'shiki'

export function isSupportedLanguage(lang: string): boolean {
  return lang in bundledLanguages
}

export function normalizeLanguage(lang: string): string {
  if (!lang) return 'text'
  
  const aliases: Record<string, string> = {
    'js': 'javascript',
    'ts': 'typescript',
    'tsx': 'tsx',
    'jsx': 'jsx',
    'py': 'python',
    'rb': 'ruby',
    'sh': 'bash',
    'shell': 'bash',
    'zsh': 'bash',
    'yml': 'yaml',
    'md': 'markdown',
    'c++': 'cpp',
    'c#': 'csharp',
    'cs': 'csharp',
    'golang': 'go',
    'rs': 'rust',
    'kt': 'kotlin',
  }
  
  const normalized = aliases[lang.toLowerCase()] || lang.toLowerCase()
  // Check if supported by shiki (if we have the bundle loaded), otherwise fallback to text or keep as is if shiki loads dynamically
  return normalized
}

export function detectLanguage(filePath?: string): string {
  if (!filePath) return 'text'
  
  // 先检查完整文件名
  const fileName = filePath.split(/[/\\]/).pop()?.toLowerCase() || ''
  const fileNameMap: Record<string, string> = {
    '.gitignore': 'gitignore',
    '.dockerignore': 'gitignore',
    '.npmignore': 'gitignore',
    '.eslintignore': 'gitignore',
    '.prettierignore': 'gitignore',
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
    'cmakelists.txt': 'cmake',
    '.env': 'dotenv',
    '.env.local': 'dotenv',
    '.env.development': 'dotenv',
    '.env.production': 'dotenv',
    '.editorconfig': 'ini',
    '.npmrc': 'ini',
    '.yarnrc': 'yaml',
    'tsconfig.json': 'jsonc',
    'jsconfig.json': 'jsonc',
    '.prettierrc': 'json',
    '.eslintrc': 'json',
    'package.json': 'json',
    'composer.json': 'json',
    'cargo.toml': 'toml',
    'pyproject.toml': 'toml',
  }
  
  if (fileNameMap[fileName]) {
    return fileNameMap[fileName]
  }
  
  // 然后检查扩展名
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const extMap: Record<string, string> = {
    js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
    html: 'html', css: 'css', scss: 'scss', less: 'less', sql: 'sql',
    xml: 'xml', toml: 'toml', vue: 'vue', svelte: 'svelte',
    ini: 'ini', conf: 'ini', cfg: 'ini',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    gitignore: 'gitignore',
    env: 'dotenv',
    kt: 'kotlin', kts: 'kotlin',
    swift: 'swift', m: 'objective-c', mm: 'objective-cpp',
    r: 'r', R: 'r',
    lua: 'lua', pl: 'perl', pm: 'perl',
    ex: 'elixir', exs: 'elixir',
    erl: 'erlang', hrl: 'erlang',
    hs: 'haskell', lhs: 'haskell',
    clj: 'clojure', cljs: 'clojure', cljc: 'clojure',
    scala: 'scala', sc: 'scala',
    groovy: 'groovy', gradle: 'groovy',
    ps1: 'powershell', psm1: 'powershell',
    fish: 'fish',
    vim: 'viml', vimrc: 'viml',
    tf: 'terraform', tfvars: 'terraform',
    proto: 'protobuf',
    graphql: 'graphql', gql: 'graphql',
    prisma: 'prisma',
  }
  return extMap[ext] || 'text'
}
