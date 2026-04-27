/**
 * auth/aclCache.ts —— decision 的进程内 LRU 缓存（TTL 10s）
 *
 * 不引入 lru-cache 依赖以减少本轮装包；实现一个轻量 LRU（max=2000, ttl=10s）。
 * 若日后规模变大再替换。
 */
import type { Decision, AclResource, AclAction, Principal } from './types.ts'

const MAX = 2000
const TTL_MS = 10_000

interface Entry {
  value: Decision
  expireAt: number
}

const store = new Map<string, Entry>()

export function aclCacheKey(
  principal: Principal,
  action: AclAction,
  resource: AclResource,
): string {
  const roles = [...principal.roles].sort().join(',')
  return [
    principal.user_id,
    roles,
    resource.source_id ?? 0,
    resource.asset_id ?? 0,
    resource.field_id ?? 0,
    action,
  ].join('|')
}

export function aclCacheGet(key: string): Decision | undefined {
  const e = store.get(key)
  if (!e) return undefined
  if (Date.now() > e.expireAt) {
    store.delete(key)
    return undefined
  }
  // LRU refresh
  store.delete(key)
  store.set(key, e)
  return e.value
}

export function aclCacheSet(key: string, value: Decision): void {
  if (store.size >= MAX) {
    // 按 Map 插入顺序删掉最老的
    const first = store.keys().next().value
    if (first != null) store.delete(first)
  }
  store.set(key, { value, expireAt: Date.now() + TTL_MS })
}

export function aclCacheFlush(): void {
  store.clear()
}

/** 测试辅助 */
export function __aclCacheSize(): number {
  return store.size
}
