/**
 * services/keywordSearch.ts —— 关键词/子串检索（BM25 替身）
 *
 * 为啥不用 PG `tsvector`/`pg_jieba`：
 *   - `to_tsvector('simple', ...)` 不分词中文，效果差
 *   - `pg_jieba` 要装扩展，不轻量
 *   - 我们这里只需要补足"短查询 + 关键词字面匹配"的盲区，
 *     `pg_trgm.similarity` + 简单子串计数足够。
 *
 * 算法：
 *   1. 从 query 抽 "信号 token"：去停用词 + 中文 char 2-gram + 英文 ≥3 字 词
 *   2. SQL 拉所有满足 `content ILIKE ANY(...)` 的 chunk
 *   3. 按"匹配 token 数 DESC + chunk 长度 ASC"排序，取 top-K
 *
 * 性能：6 万 chunk 之下、ILIKE + 内存排序，单次 < 200ms 够用。
 *      过 6 万要么加 GIN(content gin_trgm_ops) 索引，要么换 ts_vector。
 */
import { getPgPool } from './pgDb.ts'
import type { AssetChunk } from './knowledgeSearch.ts'

export interface KeywordSearchInput {
  query: string
  top_k?: number
  asset_ids?: number[]
  source_ids?: number[]
}

const STOPWORDS = new Set([
  '的', '了', '是', '在', '有', '和', '也', '都', '与', '及', '或', '但',
  '为', '于', '对', '到', '从', '把', '被', '让', '使', '可以', '可', '能',
  '什么', '怎么', '怎样', '如何', '为什么', '为何', '哪些', '哪个', '哪',
  '多少', '几', '吗', '呢', '吧', '啊', '呀',
  '一', '二', '三', '上', '下', '里', '内', '外', '中', '间',
  '请', '问', '说', '看', '我', '你', '他', '她', '它', '们',
  '这', '那', '此', '该',
  // English stopwords
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'and', 'or', 'but', 'if', 'then', 'else',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'as', 'from',
  'what', 'which', 'who', 'whose', 'when', 'where', 'why', 'how',
  'do', 'does', 'did', 'have', 'has', 'had',
])

const CJK_RE = /[\u4e00-\u9fa5\u3400-\u4dbf]/

/** 从 query 抽信号 token */
export function extractSignals(query: string): string[] {
  const q = query.trim()
  if (!q) return []
  const out = new Set<string>()

  // 1) 英文 / 数字段：长度 ≥ 2 的纯 ASCII 词（含全大写缩写如 COF / DTS / VSM）
  const asciiTokens = q.match(/[A-Za-z][A-Za-z0-9_-]{1,}/g) ?? []
  for (const t of asciiTokens) {
    const lower = t.toLowerCase()
    if (lower.length >= 2 && !STOPWORDS.has(lower)) out.add(t)   // 保留原大小写，ILIKE 不区分
  }

  // 2) 数字 + 单位：1.5mm / 80邵氏度 等
  const numUnit = q.match(/\d+(?:\.\d+)?\s*(?:mm|cm|m|nm|μm|mpa|n|kg|g|tokens|°|度|邵氏度|邵氏)/gi) ?? []
  for (const t of numUnit) out.add(t)

  // 3) 中文：2-3 char 滑窗（n-gram），非停用词、非全标点
  for (let i = 0; i < q.length; i++) {
    if (!CJK_RE.test(q[i])) continue
    for (const n of [2, 3]) {
      if (i + n > q.length) continue
      const chunk = q.slice(i, i + n)
      if (![...chunk].every((c) => CJK_RE.test(c))) continue
      if ([...chunk].some((c) => STOPWORDS.has(c))) continue   // 含停用字直接弃
      out.add(chunk)
    }
  }

  // 兜底：如果上面都没抽出来，把整个 query 当一个 token
  if (out.size === 0 && q.length >= 2) out.add(q)

  return [...out]
}

/**
 * 关键词检索：返 AssetChunk[]，结构与向量检索一致便于 RRF 融合
 * - score 字段填一个 [0, 1] 的归一化分（命中 token 数 / 总 token 数）
 * - 调用方看到 score 主要做参考，真正的排序权重在 RRF 步骤
 */
export async function searchKnowledgeByKeyword(
  input: KeywordSearchInput,
): Promise<AssetChunk[]> {
  const tokens = extractSignals(input.query)
  if (tokens.length === 0) return []

  const top_k = Math.min(50, Math.max(1, Number(input.top_k ?? 20)))
  const pool = getPgPool()

  // 构造 SQL：每个 token 一个 ILIKE，OR 起来；同时 SELECT 出每条 chunk 命中的 token 数
  // 用 unnest 数组 + 聚合，避免动态拼 SQL 不方便参数化
  const params: unknown[] = [tokens]
  const filters: string[] = []
  if (input.source_ids?.length) {
    params.push(input.source_ids)
    filters.push(`ma.source_id = ANY($${params.length}::int[])`)
  }
  if (input.asset_ids?.length) {
    params.push(input.asset_ids)
    filters.push(`mf.asset_id = ANY($${params.length}::int[])`)
  }
  const extraWhere = filters.length ? `AND ${filters.join(' AND ')}` : ''
  params.push(top_k)
  const limitIdx = params.length

  const { rows } = await pool.query(
    `SELECT
       mf.asset_id,
       ma.name        AS asset_name,
       mf.content     AS chunk_content,
       /* 匹配 token 数 / 总 token 数；归一到 [0,1]，方便给前端展示 */
       (
         SELECT COUNT(*)::float / GREATEST(array_length($1::text[], 1), 1)
         FROM unnest($1::text[]) AS t
         WHERE position(lower(t) IN lower(mf.content)) > 0
       ) AS score,
       mf.metadata
     FROM metadata_field mf
     JOIN metadata_asset ma ON ma.id = mf.asset_id
     WHERE mf.chunk_level = 3
       AND EXISTS (
         SELECT 1 FROM unnest($1::text[]) AS t
         WHERE position(lower(t) IN lower(mf.content)) > 0
       )
       ${extraWhere}
     ORDER BY score DESC, length(mf.content) ASC
     LIMIT $${limitIdx}`,
    params,
  )

  return rows as AssetChunk[]
}
