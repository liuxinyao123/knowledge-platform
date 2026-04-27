/**
 * auth/shapeResult.ts —— 按 decision.mask 对结果集做字段级整形
 *
 * mode：
 *   - hide     删除字段键
 *   - star     字段值替换为 "***"
 *   - hash     SHA-1 前 8 位 hex
 *   - truncate 保留前 4 个字符 + "..."
 */
import crypto from 'node:crypto'
import type { Decision, FieldMask } from './types.ts'

type Row = Record<string, unknown>

export function shapeRow(row: Row, masks: FieldMask[]): Row {
  const out: Row = { ...row }
  for (const m of masks) {
    if (!(m.field in out)) continue
    switch (m.mode) {
      case 'hide':
        delete out[m.field]
        break
      case 'star':
        out[m.field] = '***'
        break
      case 'hash': {
        const v = out[m.field] == null ? '' : String(out[m.field])
        out[m.field] = crypto.createHash('sha1').update(v).digest('hex').slice(0, 8)
        break
      }
      case 'truncate': {
        const v = out[m.field] == null ? '' : String(out[m.field])
        out[m.field] = v.length <= 4 ? v : v.slice(0, 4) + '...'
        break
      }
    }
  }
  return out
}

export function shapeResultByAcl<T extends object>(
  decision: Decision | undefined,
  rows: T[],
): T[] {
  if (!decision?.mask?.length) return rows
  const masks = decision.mask
  return rows.map((r) => shapeRow(r as unknown as Row, masks) as unknown as T)
}
