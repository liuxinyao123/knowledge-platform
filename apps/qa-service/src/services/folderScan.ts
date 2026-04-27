/**
 * services/folderScan.ts —— 递归扫描本地目录，产出可 ingest 的文件列表
 *
 * 设计：
 *   - 内置黑名单：.git / node_modules / .DS_Store / .env* / 二进制超大文件
 *   - 简易 glob：支持 include 与 exclude 通配（* / ** / 扩展名）
 *   - 文件大小限制：单个文件默认 INGEST_MAX_FILE_MB（env）或 50MB
 *   - 返回迭代器；调用方逐个 ingest，边扫边走 SSE
 */
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MAX_MB = 50

const HARD_BLACKLIST = new Set([
  '.git', '.svn', '.hg',
  'node_modules', '.pnpm', '.yarn',
  '.DS_Store', '.Trash', '.cache',
  'dist', 'build', '.next', '.turbo',
])

// 文件名或扩展名命中即跳过
const SKIP_PATTERNS = [
  /\.env(\.|$)/i,                 // .env / .env.local
  /\.log$/i,
  /\.(lock|lockb|lockfile)$/i,
  /\.(ico|woff2?|ttf|otf)$/i,     // 字体/图标
  /\.(min\.js|min\.css)$/i,
  /-lock\.(json|yaml)$/i,         // package-lock / pnpm-lock
]

export interface ScanOptions {
  root: string
  recursive?: boolean                   // 默认 true
  includeGlob?: string[]                // 如 ['*.md', '*.pdf']；空=默认 ingest 扩展名
  excludeGlob?: string[]                // 如 ['draft/**']
  maxFileMb?: number
}

export interface ScannedFile {
  absPath: string
  relPath: string                       // 相对 root
  name: string
  ext: string
  sizeBytes: number
}

function simpleGlobToRegex(pat: string): RegExp {
  // 转义 regex 元字符，只保留 ** / * / ? 含义
  const escaped = pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLESTAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLESTAR::/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${escaped}$`)
}

function matchesAny(patterns: string[] | undefined, rel: string): boolean {
  if (!patterns?.length) return false
  const normalized = rel.replace(/\\/g, '/')
  return patterns.some((p) => simpleGlobToRegex(p).test(normalized))
}

function shouldSkip(name: string, rel: string, includeGlob?: string[], excludeGlob?: string[]): boolean {
  if (HARD_BLACKLIST.has(name)) return true
  if (SKIP_PATTERNS.some((re) => re.test(name))) return true
  if (excludeGlob?.length && matchesAny(excludeGlob, rel)) return true
  // 有 include 约束时未命中即跳过；无约束放过（下游按扩展名再过）
  if (includeGlob?.length) {
    return !matchesAny(includeGlob, rel)
  }
  return false
}

export async function *walkFolder(opts: ScanOptions): AsyncGenerator<ScannedFile> {
  const recursive = opts.recursive !== false
  const maxMb = opts.maxFileMb ?? (Number(process.env.INGEST_MAX_FILE_MB) || DEFAULT_MAX_MB)
  const maxBytes = maxMb * 1024 * 1024
  const root = path.resolve(opts.root)

  async function *walk(dir: string): AsyncGenerator<ScannedFile> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name)
      const rel = path.relative(root, full) || ent.name

      if (ent.isDirectory()) {
        // 黑名单/glob 排除先作用在目录本身（省遍历）
        if (HARD_BLACKLIST.has(ent.name)) continue
        if (opts.excludeGlob?.length && matchesAny(opts.excludeGlob, rel)) continue
        if (recursive) yield* walk(full)
        continue
      }
      if (!ent.isFile()) continue

      if (shouldSkip(ent.name, rel, opts.includeGlob, opts.excludeGlob)) continue

      let size = 0
      try {
        const s = await stat(full)
        size = s.size
      } catch {
        continue
      }
      if (size <= 0 || size > maxBytes) continue

      yield {
        absPath: full,
        relPath: rel,
        name: ent.name,
        ext: path.extname(ent.name).toLowerCase(),
        sizeBytes: size,
      }
    }
  }

  yield* walk(root)
}
