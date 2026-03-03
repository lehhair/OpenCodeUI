// ============================================
// Material Icon Theme - Lean Icon Resolver
// Hand-written mapping for ~80 common file types + folders
// SVGs served from public/material-icons/ (copied at postinstall)
// ============================================

/** icon SVG filename (without .svg) */
type Icon = string

// ---- file name → icon (exact match, lowercase) ----
const FILE_NAMES: Record<string, Icon> = {
  // Package managers & Node
  'package.json': 'nodejs',
  'package-lock.json': 'nodejs',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'bunfig.toml': 'bun',
  '.nvmrc': 'nodejs',
  '.node-version': 'nodejs',
  // Docker
  dockerfile: 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  '.dockerignore': 'docker',
  // Git
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  // TS / JS config
  'tsconfig.json': 'tsconfig',
  'jsconfig.json': 'jsconfig',
  // Linters & formatters
  '.eslintrc': 'eslint',
  '.eslintrc.js': 'eslint',
  '.eslintrc.json': 'eslint',
  '.eslintrc.cjs': 'eslint',
  'eslint.config.js': 'eslint',
  'eslint.config.ts': 'eslint',
  'eslint.config.mjs': 'eslint',
  '.prettierrc': 'prettier',
  '.prettierrc.js': 'prettier',
  '.prettierrc.json': 'prettier',
  '.prettierrc.yml': 'prettier',
  // Build tools
  'vite.config.js': 'vite',
  'vite.config.ts': 'vite',
  'vite.config.mts': 'vite',
  'webpack.config.js': 'webpack',
  'webpack.config.ts': 'webpack',
  'rollup.config.js': 'rollup',
  'rollup.config.ts': 'rollup',
  'turbo.json': 'turborepo',
  'gulpfile.js': 'gulp',
  makefile: 'makefile',
  'cmake': 'cmake',
  'cmakelists.txt': 'cmake',
  // Framework config
  'tailwind.config.js': 'tailwindcss',
  'tailwind.config.ts': 'tailwindcss',
  'next.config.js': 'next',
  'next.config.mjs': 'next',
  'next.config.ts': 'next',
  'nuxt.config.js': 'nuxt',
  'nuxt.config.ts': 'nuxt',
  'svelte.config.js': 'svelte',
  'astro.config.mjs': 'astro-config',
  'astro.config.js': 'astro-config',
  'astro.config.ts': 'astro-config',
  'angular.json': 'angular',
  'vue.config.js': 'vue-config',
  // Test
  'jest.config.js': 'jest',
  'jest.config.ts': 'jest',
  'vitest.config.js': 'vitest',
  'vitest.config.ts': 'vitest',
  // Language-specific
  'cargo.toml': 'rust',
  'cargo.lock': 'rust',
  'go.mod': 'go-mod',
  'go.sum': 'go-mod',
  'requirements.txt': 'python',
  'pyproject.toml': 'python',
  'pipfile': 'python',
  'gemfile': 'ruby',
  'rakefile': 'ruby',
  'composer.json': 'php',
  'build.gradle': 'gradle',
  'pom.xml': 'maven',
  'deno.json': 'deno',
  'deno.jsonc': 'deno',
  // Cloud / deploy
  'vercel.json': 'vercel',
  'netlify.toml': 'netlify',
  'firebase.json': 'firebase',
  // Env
  '.env': 'settings',
  '.env.local': 'settings',
  '.env.development': 'settings',
  '.env.production': 'settings',
  '.env.example': 'settings',
  '.editorconfig': 'settings',
  // Docs
  'readme.md': 'readme',
  'changelog.md': 'changelog',
  'license': 'license',
  'license.md': 'license',
  // Misc
  '.babelrc': 'babel',
  'babel.config.js': 'babel',
  'nx.json': 'json',
  '.storybook': 'storybook',
}

// ---- file extension → icon (longest compound match first) ----
// Order matters: compound extensions like "spec.ts" should come before "ts"
const FILE_EXTENSIONS: [ext: string, icon: Icon][] = [
  // Compound extensions (tested first)
  ['spec.ts', 'typescript'],
  ['test.ts', 'typescript'],
  ['spec.tsx', 'react_ts'],
  ['test.tsx', 'react_ts'],
  ['spec.js', 'javascript'],
  ['test.js', 'javascript'],
  ['spec.jsx', 'react'],
  ['test.jsx', 'react'],
  ['d.ts', 'typescript-def'],
  ['js.map', 'javascript-map'],
  ['css.map', 'css-map'],
  // TypeScript / JavaScript
  ['ts', 'typescript'],
  ['tsx', 'react_ts'],
  ['js', 'javascript'],
  ['jsx', 'react'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['mts', 'typescript'],
  ['cts', 'typescript'],
  // Web
  ['html', 'html'],
  ['htm', 'html'],
  ['css', 'css'],
  ['scss', 'sass'],
  ['sass', 'sass'],
  ['less', 'less'],
  // Data
  ['json', 'json'],
  ['jsonc', 'json'],
  ['json5', 'json'],
  ['xml', 'xml'],
  ['yml', 'yaml'],
  ['yaml', 'yaml'],
  ['toml', 'toml'],
  ['csv', 'json'],
  // Docs
  ['md', 'markdown'],
  ['mdx', 'mdx'],
  // Languages
  ['py', 'python'],
  ['pyw', 'python'],
  ['rs', 'rust'],
  ['go', 'go'],
  ['java', 'java'],
  ['kt', 'kotlin'],
  ['kts', 'kotlin'],
  ['scala', 'scala'],
  ['php', 'php'],
  ['rb', 'ruby'],
  ['cs', 'csharp'],
  ['fs', 'fsharp'],
  ['cpp', 'cpp'],
  ['cc', 'cpp'],
  ['cxx', 'cpp'],
  ['c', 'c'],
  ['h', 'c'],
  ['hpp', 'cpp'],
  ['swift', 'swift'],
  ['dart', 'dart'],
  ['lua', 'lua'],
  ['pl', 'perl'],
  ['r', 'r'],
  ['jl', 'julia'],
  ['hs', 'haskell'],
  ['elm', 'settings'],
  ['ml', 'ocaml'],
  ['clj', 'clojure'],
  ['cljs', 'clojure'],
  ['ex', 'elixir'],
  ['exs', 'elixir'],
  ['erl', 'erlang'],
  ['nim', 'nim'],
  ['zig', 'zig'],
  ['asm', 'assembly'],
  ['s', 'assembly'],
  // Shell
  ['sh', 'console'],
  ['bash', 'console'],
  ['zsh', 'console'],
  ['fish', 'console'],
  ['ps1', 'powershell'],
  // Framework
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['astro', 'astro'],
  // Config
  ['cfg', 'settings'],
  ['ini', 'settings'],
  ['conf', 'settings'],
  ['properties', 'settings'],
  ['env', 'settings'],
  ['lock', 'lock'],
  // Media
  ['svg', 'svg'],
  ['png', 'image'],
  ['jpg', 'image'],
  ['jpeg', 'image'],
  ['gif', 'image'],
  ['webp', 'image'],
  ['ico', 'image'],
  ['bmp', 'image'],
  ['mp4', 'video'],
  ['mov', 'video'],
  ['avi', 'video'],
  ['webm', 'video'],
  ['mp3', 'audio'],
  ['wav', 'audio'],
  ['flac', 'audio'],
  // Archive
  ['zip', 'zip'],
  ['tar', 'zip'],
  ['gz', 'zip'],
  ['rar', 'zip'],
  ['7z', 'zip'],
  // Documents
  ['pdf', 'pdf'],
  // Database
  ['sql', 'database'],
  ['db', 'database'],
  ['sqlite', 'database'],
  // Other
  ['log', 'settings'],
  ['key', 'key'],
  ['pem', 'certificate'],
  ['crt', 'certificate'],
  ['proto', 'proto'],
  ['graphql', 'graphql'],
  ['gql', 'graphql'],
  ['wasm', 'document'],
  ['prisma', 'prisma'],
  ['ttf', 'font'],
  ['otf', 'font'],
  ['woff', 'font'],
  ['woff2', 'font'],
]

// ---- folder name → icon SVG base name (without -open suffix) ----
// We'll append "-open" for expanded state automatically
const FOLDER_NAMES: Record<string, Icon> = {
  src: 'folder-src',
  source: 'folder-src',
  lib: 'folder-lib',
  libs: 'folder-lib',
  // Test
  test: 'folder-test',
  tests: 'folder-test',
  __tests__: 'folder-test',
  spec: 'folder-test',
  specs: 'folder-test',
  e2e: 'folder-test',
  cypress: 'folder-cypress',
  // Dependencies
  node_modules: 'folder-node',
  vendor: 'folder-packages',
  packages: 'folder-packages',
  // Build
  build: 'folder-buildkite',
  dist: 'folder-dist',
  out: 'folder-dist',
  output: 'folder-dist',
  target: 'folder-target',
  // Config
  config: 'folder-config',
  configs: 'folder-config',
  settings: 'folder-config',
  env: 'folder-environment',
  // Docker
  docker: 'folder-docker',
  // Docs
  docs: 'folder-docs',
  doc: 'folder-docs',
  documentation: 'folder-docs',
  // Assets
  public: 'folder-public',
  static: 'folder-public',
  assets: 'folder-images',
  images: 'folder-images',
  img: 'folder-images',
  icons: 'folder-images',
  media: 'folder-images',
  fonts: 'folder-font',
  // Styles
  styles: 'folder-css',
  css: 'folder-css',
  scss: 'folder-sass',
  sass: 'folder-sass',
  less: 'folder-less',
  // Code structure
  components: 'folder-components',
  component: 'folder-components',
  views: 'folder-views',
  view: 'folder-views',
  pages: 'folder-views',
  layouts: 'folder-layout',
  layout: 'folder-layout',
  templates: 'folder-template',
  template: 'folder-template',
  hooks: 'folder-hook',
  hook: 'folder-hook',
  store: 'folder-store',
  stores: 'folder-store',
  state: 'folder-ngrx-store',
  services: 'folder-api',
  service: 'folder-api',
  api: 'folder-api',
  apis: 'folder-api',
  routes: 'folder-routes',
  route: 'folder-routes',
  routing: 'folder-routes',
  middleware: 'folder-middleware',
  middlewares: 'folder-middleware',
  controllers: 'folder-controller',
  controller: 'folder-controller',
  models: 'folder-database',
  model: 'folder-database',
  schemas: 'folder-database',
  schema: 'folder-database',
  migrations: 'folder-database',
  database: 'folder-database',
  db: 'folder-database',
  prisma: 'folder-prisma',
  drizzle: 'folder-drizzle',
  // Scripts & utils
  scripts: 'folder-scripts',
  script: 'folder-scripts',
  tools: 'folder-tools',
  utils: 'folder-utils',
  utilities: 'folder-utils',
  helpers: 'folder-helper',
  // Types
  types: 'folder-typescript',
  typings: 'folder-typescript',
  '@types': 'folder-typescript',
  interfaces: 'folder-interface',
  // i18n
  i18n: 'folder-i18n',
  locales: 'folder-i18n',
  locale: 'folder-i18n',
  lang: 'folder-i18n',
  // Infra
  kubernetes: 'folder-kubernetes',
  k8s: 'folder-kubernetes',
  terraform: 'folder-terraform',
  firebase: 'folder-firebase',
  supabase: 'folder-supabase',
  vercel: 'folder-vercel',
  netlify: 'folder-netlify',
  // CI/CD
  '.github': 'folder-github',
  '.gitlab': 'folder-gitlab',
  '.circleci': 'folder-circleci',
  ci: 'folder-ci',
  workflows: 'folder-gh-workflows',
  // Dev tools
  '.git': 'folder-git',
  '.vscode': 'folder-vscode',
  '.idea': 'folder-intellij',
  '.cursor': 'folder-cursor',
  '.devcontainer': 'folder-container',
  '.storybook': 'folder-storybook',
  // Platform
  android: 'folder-android',
  ios: 'folder-ios',
  mobile: 'folder-mobile',
  desktop: 'folder-desktop',
  windows: 'folder-windows',
  linux: 'folder-linux',
  macos: 'folder-macos',
  // Other
  temp: 'folder-temp',
  tmp: 'folder-temp',
  logs: 'folder-log',
  log: 'folder-log',
  examples: 'folder-examples',
  example: 'folder-examples',
  demo: 'folder-examples',
  samples: 'folder-examples',
  mocks: 'folder-mock',
  mock: 'folder-mock',
  fixtures: 'folder-test',
  data: 'folder-database',
  content: 'folder-content',
  functions: 'folder-functions',
  serverless: 'folder-serverless',
  server: 'folder-server',
  auth: 'folder-secure',
  security: 'folder-secure',
  keys: 'folder-keys',
  certs: 'folder-keys',
  queue: 'folder-queue',
  jobs: 'folder-job',
  tasks: 'folder-tasks',
  // Framework
  'src-tauri': 'folder-src-tauri',
  core: 'folder-core',
  shared: 'folder-shared',
  context: 'folder-context',
}

// ---- defaults ----
const DEFAULT_FILE: Icon = 'file'
const DEFAULT_FOLDER: Icon = 'folder'
const DEFAULT_FOLDER_OPEN: Icon = 'folder-open'

// ---- helpers ----

const _base = import.meta.env.BASE_URL

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
}

function resolveFileIcon(path: string): Icon {
  const name = basename(path).toLowerCase()

  // 1. exact filename match
  const byName = FILE_NAMES[name]
  if (byName) return byName

  // 2. extension match - try compound extensions first (longest match)
  for (const [ext, icon] of FILE_EXTENSIONS) {
    if (name.endsWith('.' + ext)) return icon
  }

  return DEFAULT_FILE
}

function resolveFolderIcon(path: string, expanded: boolean): Icon {
  const name = basename(path).toLowerCase()
  const base = FOLDER_NAMES[name]
  if (base) return expanded ? base + '-open' : base
  return expanded ? DEFAULT_FOLDER_OPEN : DEFAULT_FOLDER
}

/**
 * Get the material icon SVG URL for a file or folder.
 */
export function getMaterialIconUrl(
  path: string,
  type: 'file' | 'directory',
  expanded = false,
): string {
  const icon =
    type === 'directory'
      ? resolveFolderIcon(path, expanded)
      : resolveFileIcon(path)
  return `${_base}material-icons/${icon}.svg`
}
