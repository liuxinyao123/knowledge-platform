/**
 * services/fileSource/factory.ts —— adapter 工厂
 */
import type { FileSourceAdapter, FileSourceType } from './types.ts'
import { FileSourceTypeNotImplemented } from './types.ts'
import { SmbAdapter } from './adapters/smbAdapter.ts'

export function makeAdapter(type: FileSourceType): FileSourceAdapter {
  switch (type) {
    case 'smb':    return new SmbAdapter()
    case 's3':     throw new FileSourceTypeNotImplemented('s3')
    case 'webdav': throw new FileSourceTypeNotImplemented('webdav')
    case 'sftp':   throw new FileSourceTypeNotImplemented('sftp')
    default: {
      const _exhaustive: never = type
      throw new FileSourceTypeNotImplemented(String(_exhaustive))
    }
  }
}
