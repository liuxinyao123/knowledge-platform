/**
 * services/fileSource/adapters/smbAdapter.ts —— SMB/CIFS 协议 adapter
 *
 * 依赖 `@marsaud/smb2`（NTLMv2，SMB2/SMB3）。package 在 package.json 里声明，但
 * 我们在 init() 阶段才动态 require，这样未安装时其它 adapter / 调度器仍能工作。
 *
 * 稳定 id 规范：`\\${host}\${share}${path}`（反斜杠归一）
 */
import { createRequire } from 'node:module'
import type {
  FileSourceAdapter, FileSourceDescriptor, FetchedFile, ListCursor, ListResult,
} from '../types.ts'
import {
  InvalidFileSourceConfig, FileSourceAuthError, FileSourceNetworkError, FileSourceProtocolError,
  FileSourceNotFoundError, FileSourceFileTooLarge, FileSourceTimeout, FileSourceClosed,
} from '../types.ts'

interface SmbConfig {
  host: string
  share: string
  /** share 内相对路径，以 '/' 开头 */
  path: string
  domain?: string
  username: string
  password: string   // decryptConfig 已解密
  timeout_ms?: number
  max_file_mb?: number
}

// Skip list（大小写不敏感）
const SKIP_DIR_NAMES = new Set(['$RECYCLE.BIN', '.snapshot', '.AppleDouble'])
const SKIP_FILE_RE = /^(\.|Thumbs\.db$|desktop\.ini$|.*\.lnk$)/i

function normalizePath(p: string): string {
  if (!p.startsWith('/')) p = '/' + p
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}
function stableId(host: string, share: string, absPath: string): string {
  return `\\\\${host}\\${share}${absPath.replace(/\//g, '\\')}`
}

export class SmbAdapter implements FileSourceAdapter {
  readonly type = 'smb' as const
  private client: unknown = null
  private config: SmbConfig | null = null
  private rootPath = '/'
  private closed = false
  private timeoutMs = 30_000
  private maxFileBytes = 200 * 1024 * 1024

  async init(rawConfig: unknown): Promise<void> {
    if (typeof rawConfig !== 'object' || rawConfig === null) {
      throw new InvalidFileSourceConfig('config must be an object')
    }
    const c = rawConfig as Partial<SmbConfig>
    for (const k of ['host', 'share', 'username', 'password'] as const) {
      if (!c[k] || typeof c[k] !== 'string') {
        throw new InvalidFileSourceConfig(`${k} required`)
      }
    }
    const path = c.path ?? '/'
    this.config = {
      host: c.host!,
      share: c.share!,
      path: normalizePath(path),
      domain: c.domain,
      username: c.username!,
      password: c.password!,
      timeout_ms: c.timeout_ms ?? 30_000,
      max_file_mb: c.max_file_mb ?? 200,
    }
    this.rootPath = this.config.path
    this.timeoutMs = this.config.timeout_ms ?? 30_000
    this.maxFileBytes = (this.config.max_file_mb ?? 200) * 1024 * 1024

    // 动态加载 package；ts stub 在 src/types/smb2.d.ts
    let SMB2: new (opts: {
      share: string
      domain?: string
      username: string
      password: string
      autoCloseTimeout?: number
    }) => unknown
    try {
      const req = createRequire(import.meta.url)
      SMB2 = req('@marsaud/smb2') as typeof SMB2
    } catch (err) {
      throw new FileSourceProtocolError(
        '@marsaud/smb2 package not installed; run `pnpm install` in apps/qa-service',
      )
    }

    try {
      this.client = new SMB2({
        share: `\\\\${this.config.host}\\${this.config.share}`,
        domain: this.config.domain,
        username: this.config.username,
        password: this.config.password,
        autoCloseTimeout: 0,
      })
    } catch (err) {
      throw new FileSourceNetworkError(
        `failed to init SMB client for \\\\${this.config.host}\\${this.config.share}`,
        { cause: err },
      )
    }

    // 试探：对 root 做一次 readdir，拦截 auth/protocol/network 错
    try {
      await this.readdir(this.rootPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/STATUS_LOGON_FAILURE|STATUS_ACCESS_DENIED|auth/i.test(msg)) {
        throw new FileSourceAuthError('SMB authentication failed', { cause: err })
      }
      if (/SMB1|NEGOTIATE/i.test(msg)) {
        throw new FileSourceProtocolError('SMB1 not supported; enable SMB2 or SMB3 on server')
      }
      throw new FileSourceNetworkError(`SMB connect failed: ${msg}`, { cause: err })
    }
  }

  async listFiles(cursor: ListCursor): Promise<ListResult> {
    this.assertOpen()
    const nowIso = new Date().toISOString()
    const descriptors = await this.walk(this.rootPath)
    const seenNow = new Set(descriptors.map((d) => d.id))
    const lastSeen = new Set(cursor.seenIds)
    const lastScanAt = cursor.lastScanAt ? new Date(cursor.lastScanAt) : null

    const added: FileSourceDescriptor[] = []
    const updated: FileSourceDescriptor[] = []
    for (const d of descriptors) {
      if (!lastSeen.has(d.id)) {
        added.push(d)
      } else if (!lastScanAt || d.mtime > lastScanAt) {
        updated.push(d)
      }
    }
    const removed: string[] = []
    for (const id of lastSeen) if (!seenNow.has(id)) removed.push(id)

    return {
      added, updated, removed,
      nextCursor: { lastScanAt: nowIso, seenIds: [...seenNow] },
    }
  }

  async fetchFile(id: string): Promise<FetchedFile> {
    this.assertOpen()
    const cfg = this.config!
    const relPath = this.stableIdToRelPath(id)
    if (!relPath) throw new FileSourceNotFoundError(id)

    // 先 stat 拿 size，超限不真下载
    let stats: { size: number; mtime: Date; isFile(): boolean }
    try {
      stats = await this.stat(relPath)
    } catch (err) {
      if (/not.?found|enoent|STATUS_OBJECT_NAME_NOT_FOUND/i.test(String(err))) {
        throw new FileSourceNotFoundError(id)
      }
      throw err
    }
    if (!stats.isFile()) throw new FileSourceNotFoundError(id)
    if (stats.size > this.maxFileBytes) {
      throw new FileSourceFileTooLarge(stats.size, this.maxFileBytes, id)
    }

    const t0 = Date.now()
    const buffer = await this.withTimeout(this.readFile(relPath), this.timeoutMs, id, t0)
    const name = relPath.split('/').pop() || 'unnamed'
    return {
      buffer,
      descriptor: {
        id,
        name: this.sanitizeName(name),
        path: relPath.slice(cfg.path.length) || '/',
        size: stats.size,
        mtime: new Date(stats.mtime),
      },
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      (this.client as { disconnect?: () => void } | null)?.disconnect?.()
    } catch { /* best effort */ }
    this.client = null
  }

  // ── internals ──────────────────────────────────────────────────────────

  private assertOpen(): void {
    if (this.closed || !this.client) throw new FileSourceClosed()
  }

  private async walk(absPath: string): Promise<FileSourceDescriptor[]> {
    const cfg = this.config!
    const results: FileSourceDescriptor[] = []
    const queue: string[] = [absPath]
    while (queue.length) {
      const cur = queue.shift()!
      let entries: string[]
      try {
        entries = await this.readdir(cur)
      } catch (err) {
        // 权限拒绝 / 目录消失：跳过，不中断
        // eslint-disable-next-line no-console
        console.warn(`[smb] skip dir ${cur}: ${(err as Error).message}`)
        continue
      }
      for (const name of entries) {
        if (SKIP_DIR_NAMES.has(name) || SKIP_FILE_RE.test(name)) continue
        const childAbs = (cur === '/' ? '' : cur) + '/' + name
        let stats: { size: number; mtime: Date; isFile(): boolean; isDirectory(): boolean }
        try {
          stats = await this.stat(childAbs)
        } catch {
          continue
        }
        if (stats.isDirectory()) {
          queue.push(childAbs)
        } else if (stats.isFile()) {
          results.push({
            id: stableId(cfg.host, cfg.share, childAbs),
            name: this.sanitizeName(name),
            path: childAbs.slice(cfg.path.length) || '/' + name,
            size: stats.size,
            mtime: new Date(stats.mtime),
          })
        }
      }
    }
    return results
  }

  private stableIdToRelPath(id: string): string | null {
    const cfg = this.config!
    const prefix = `\\\\${cfg.host}\\${cfg.share}`
    if (!id.startsWith(prefix)) return null
    const rest = id.slice(prefix.length).replace(/\\/g, '/')
    return rest.startsWith('/') ? rest : '/' + rest
  }

  private sanitizeName(raw: string): string {
    // 粗略：保留 UTF-8 可显示字符；替换零宽 + 控制字符
    return raw.replace(/[\u0000-\u001f\u007f]/g, '_').trim() || 'unnamed'
  }

  private readdir(path: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      (this.client as { readdir: (p: string, cb: (e: Error | null, files: string[]) => void) => void })
        .readdir(path, (err, files) => (err ? reject(err) : resolve(files)))
    })
  }
  private stat(path: string): Promise<{ size: number; mtime: Date; isFile(): boolean; isDirectory(): boolean }> {
    return new Promise((resolve, reject) => {
      (this.client as { stat: (p: string, cb: (e: Error | null, s: never) => void) => void })
        .stat(path, (err, s) => (err ? reject(err) : resolve(s)))
    })
  }
  private readFile(path: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      (this.client as { readFile: (p: string, cb: (e: Error | null, d: Buffer) => void) => void })
        .readFile(path, (err, d) => (err ? reject(err) : resolve(d)))
    })
  }

  private withTimeout<T>(p: Promise<T>, ms: number, id: string, t0: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new FileSourceTimeout(id, Date.now() - t0)), ms)
      p.then(
        (v) => { clearTimeout(timer); resolve(v) },
        (e) => { clearTimeout(timer); reject(e) },
      )
    })
  }
}
