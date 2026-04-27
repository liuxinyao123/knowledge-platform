/**
 * 质量评分：固定 4 类问题 + 批量修复
 */
import { getPgPool } from '../pgDb.ts'
import { extractTags } from '../tagExtract.ts'

export type QualityIssueKind =
  | 'missing_author'
  | 'stale'
  | 'empty_content'
  | 'no_tags'

export interface QualityIssueGroup {
  kind: QualityIssueKind
  description: string
  count: number
  hint: string
}

const META: Record<QualityIssueKind, { description: string; hint: string }> = {
  missing_author: { description: '缺少作者元数据', hint: '回填默认作者或邀请补充' },
  stale: { description: '超过 180 天未更新', hint: '通知 Owner 复审' },
  empty_content: { description: '正文为空', hint: '建议下线或重新入库' },
  no_tags: { description: '未抽取到标签', hint: '重新触发标签提取' },
}

export async function listQualityIssues(): Promise<QualityIssueGroup[]> {
  const pool = getPgPool()
  const { rows } = await pool.query<{ kind: string; n: string }>(
    `SELECT 'missing_author' AS kind, COUNT(*) AS n FROM metadata_asset
       WHERE merged_into IS NULL AND (author IS NULL OR author = '')
     UNION ALL
     SELECT 'no_tags', COUNT(*) FROM metadata_asset
       WHERE merged_into IS NULL AND (tags IS NULL OR cardinality(tags) = 0)
     UNION ALL
     SELECT 'stale', COUNT(*) FROM metadata_asset
       WHERE merged_into IS NULL
         AND indexed_at IS NOT NULL
         AND indexed_at < NOW() - INTERVAL '180 days'
     UNION ALL
     SELECT 'empty_content', COUNT(*) FROM metadata_asset
       WHERE merged_into IS NULL AND (content IS NULL OR length(trim(content)) = 0)`,
  )
  return rows
    .map((r) => {
      const k = r.kind as QualityIssueKind
      const meta = META[k]
      return { kind: k, description: meta.description, hint: meta.hint, count: Number(r.n) }
    })
    .filter((g) => g.count > 0)
}

export async function listIssueAssets(
  kind: QualityIssueKind,
  limit = 50,
): Promise<Array<{ id: number; name: string; updatedAt?: string }>> {
  const pool = getPgPool()
  const where = whereForKind(kind)
  const { rows } = await pool.query<{ id: number; name: string; updated_at?: string }>(
    `SELECT id, name, updated_at FROM metadata_asset
     WHERE merged_into IS NULL AND ${where}
     ORDER BY id DESC LIMIT $1`,
    [limit],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    updatedAt: r.updated_at,
  }))
}

function whereForKind(kind: QualityIssueKind): string {
  switch (kind) {
    case 'missing_author':
      return `(author IS NULL OR author = '')`
    case 'no_tags':
      return `(tags IS NULL OR cardinality(tags) = 0)`
    case 'stale':
      return `indexed_at IS NOT NULL AND indexed_at < NOW() - INTERVAL '180 days'`
    case 'empty_content':
      return `(content IS NULL OR length(trim(content)) = 0)`
  }
}

export async function fixIssueBatch(
  kind: QualityIssueKind,
  assetIds: number[],
): Promise<{ fixed: number; reminded?: number[] }> {
  if (!assetIds.length) return { fixed: 0 }
  const pool = getPgPool()

  if (kind === 'missing_author') {
    const { rowCount } = await pool.query(
      `UPDATE metadata_asset SET author = '系统'
       WHERE id = ANY($1::int[]) AND (author IS NULL OR author = '')`,
      [assetIds],
    )
    return { fixed: rowCount ?? 0 }
  }
  if (kind === 'no_tags') {
    let fixed = 0
    for (const id of assetIds) {
      const { rows } = await pool.query<{ name: string; content: string }>(
        `SELECT name, content FROM metadata_asset WHERE id = $1`,
        [id],
      )
      if (!rows[0] || !rows[0].content) continue
      const tags = await extractTags(rows[0].content, { assetName: rows[0].name })
      if (tags.length) {
        await pool.query(`UPDATE metadata_asset SET tags = $2 WHERE id = $1`, [id, tags])
        fixed++
      }
    }
    return { fixed }
  }
  if (kind === 'empty_content') {
    const { rowCount } = await pool.query(
      `UPDATE metadata_asset SET merged_into = -1
       WHERE id = ANY($1::int[]) AND (content IS NULL OR length(trim(content)) = 0)`,
      [assetIds],
    )
    return { fixed: rowCount ?? 0 }
  }
  if (kind === 'stale') {
    // 不自动修；仅记录"已通知"
    return { fixed: 0, reminded: assetIds }
  }
  return { fixed: 0 }
}
