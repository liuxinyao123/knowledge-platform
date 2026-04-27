/**
 * services/audit.ts —— 审计日志唯一入口
 *
 * 设计：
 *   - 同步写 PG（不引 queue）；失败仅 WARN，不抛
 *   - 任何写操作（ingest / acl 变更 / tag 合并 / asset 合并 / quality 修复）必须调
 */
import { getPgPool } from './pgDb.ts'
import type { Principal } from '../auth/types.ts'

export interface AuditEntry {
  action: string
  targetType?: string
  targetId?: string | number
  detail?: Record<string, unknown>
  principal?: Principal
  sourceIp?: string
}

export async function writeAudit(e: AuditEntry): Promise<void> {
  try {
    const pool = getPgPool()
    await pool.query(
      `INSERT INTO audit_log
        (principal_user_id, principal_email, action, target_type, target_id, detail, source_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        e.principal?.user_id ?? null,
        e.principal?.email ?? null,
        e.action,
        e.targetType ?? null,
        e.targetId == null ? null : String(e.targetId),
        e.detail ? JSON.stringify(e.detail) : null,
        e.sourceIp ?? null,
      ],
    )
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `WARN: audit write failed for ${e.action}: ${err instanceof Error ? err.message : 'unknown'}`,
    )
  }
}
