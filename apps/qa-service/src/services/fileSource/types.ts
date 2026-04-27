/**
 * services/fileSource/types.ts —— adapter 通用契约（file-source-adapter-spec 的 TS 投影）
 */

export type FileSourceType = 'smb' | 's3' | 'webdav' | 'sftp'

export interface FileSourceDescriptor {
  /** adapter-specific 稳定 id（SMB 用绝对路径；S3 用 key；WebDAV 用 href；SFTP 用绝对路径） */
  id: string
  /** basename */
  name: string
  /** 相对 source root 的路径，以 '/' 开头；UI 面包屑可用 */
  path: string
  size: number
  mtime: Date
  /** 可选；缺失由 extractor 按扩展名推断 */
  mime?: string
}

export interface ListCursor {
  /** ISO 8601 UTC；首次扫为 null */
  lastScanAt: string | null
  /** 上次见到的 descriptor.id 全集 */
  seenIds: string[]
}

export interface ListResult {
  added:   FileSourceDescriptor[]
  updated: FileSourceDescriptor[]
  removed: string[]
  nextCursor: ListCursor
}

export interface FetchedFile {
  buffer: Buffer
  descriptor: FileSourceDescriptor
}

export interface FileSourceAdapter {
  readonly type: FileSourceType
  init(config: unknown): Promise<void>
  listFiles(cursor: ListCursor): Promise<ListResult>
  fetchFile(id: string): Promise<FetchedFile>
  close(): Promise<void>
}

// ── Errors ─────────────────────────────────────────────────────────────────

export class InvalidFileSourceConfig extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidFileSourceConfig' }
}
export class FileSourceAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options); this.name = 'FileSourceAuthError'
  }
}
export class FileSourceNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options); this.name = 'FileSourceNetworkError'
  }
}
export class FileSourceProtocolError extends Error {
  constructor(message: string) { super(message); this.name = 'FileSourceProtocolError' }
}
export class FileSourceNotFoundError extends Error {
  constructor(id: string) { super(`file not found: ${id}`); this.name = 'FileSourceNotFoundError' }
}
export class FileSourceFileTooLarge extends Error {
  readonly size: number
  readonly limit: number
  constructor(size: number, limit: number, id: string) {
    super(`file ${id} is ${size} bytes, exceeds limit ${limit}`)
    this.name = 'FileSourceFileTooLarge'
    this.size = size
    this.limit = limit
  }
}
export class FileSourceTimeout extends Error {
  constructor(id: string, elapsedMs: number) {
    super(`fetchFile(${id}) timed out after ${elapsedMs}ms`); this.name = 'FileSourceTimeout'
  }
}
export class FileSourceClosed extends Error {
  constructor() { super('adapter already closed'); this.name = 'FileSourceClosed' }
}
export class FileSourceDisconnected extends Error {
  constructor(message = 'remote connection dropped') { super(message); this.name = 'FileSourceDisconnected' }
}
export class FileSourceTypeNotImplemented extends Error {
  constructor(type: string) { super(`file source type not implemented: ${type}`); this.name = 'FileSourceTypeNotImplemented' }
}
export class MasterEncryptKeyMissing extends Error {
  constructor() {
    super('MASTER_ENCRYPT_KEY env var required; must be 64 hex chars (32 bytes)')
    this.name = 'MasterEncryptKeyMissing'
  }
}

// ── SYSTEM principal（scan 入库使用） ───────────────────────────────────────

export const SYSTEM_PRINCIPAL = {
  user_id: 0,
  email: 'system',
  roles: ['system'] as string[],
  permissions: [] as string[],
  team_ids: [] as string[],
  team_names: [] as string[],
} as const
export type SystemPrincipal = typeof SYSTEM_PRINCIPAL
