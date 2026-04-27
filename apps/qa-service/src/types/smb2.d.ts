/**
 * 最小 types stub for @marsaud/smb2。
 *
 * 本仓库用到的子集。package 未安装时 tsc 仍能通过；运行期由 factory.ts 的
 * 动态 import 加载真 package，缺失则抛可读错误。
 */
declare module '@marsaud/smb2' {
  interface SMB2Opts {
    share: string
    domain?: string
    username: string
    password: string
    autoCloseTimeout?: number
    packetConcurrency?: number
  }
  interface Stats {
    size: number
    mtime: Date
    isDirectory(): boolean
    isFile(): boolean
  }
  export default class SMB2Client {
    constructor(opts: SMB2Opts)
    readdir(path: string, cb: (err: Error | null, files: string[]) => void): void
    stat(path: string, cb: (err: Error | null, stats: Stats) => void): void
    readFile(path: string, cb: (err: Error | null, data: Buffer) => void): void
    exists(path: string, cb: (err: Error | null, exists: boolean) => void): void
    disconnect(): void
  }
}
