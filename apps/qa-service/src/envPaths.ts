import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 与 index.ts 使用同一规则：apps/qa-service/.env */
export function qaServiceDotenvPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '.env')
}

export function repoRootDotenvPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env')
}
