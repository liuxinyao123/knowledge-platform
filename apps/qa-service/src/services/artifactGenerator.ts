/**
 * services/artifactGenerator.ts —— Notebook Studio 衍生品生成
 *
 * 当前支持：
 *   - briefing  结构化简报
 *   - faq       8-12 条 Q&A
 *
 * 调用 LLM 一次生成（非流式）；生成时 status=running，完成 status=done，
 * content 写入 markdown 主体；meta 记录 sources_snapshot 快照。
 */
import { getPgPool } from './pgDb.ts'
import { chatComplete } from './llm.ts'
import { searchKnowledgeChunks } from './knowledgeSearch.ts'

export type ArtifactKind = 'briefing' | 'faq'

interface SourceContent {
  asset_id: number
  asset_name: string
  text: string         // 拼接的代表性 chunk
}

const PROMPT_BRIEFING = `基于以下文档生成一份结构化简报。

格式（markdown）：
# {标题}
## 一、核心论点
（每个文档 1-2 句话提炼）
## 二、共识与分歧
（不同文档间的对比）
## 三、关键数据 / 指标
（具体数字、阈值、参数）
## 四、行动建议
（基于内容能给出的下一步）

要求：
- 严格基于文档内容，不引入外部知识
- 每个论点末尾标 [^N] 引用文档编号
- 篇幅 800-1500 字
- 中文输出（除非文档全是英文）`

const PROMPT_FAQ = `基于以下文档生成 8-12 条最有价值的 FAQ。

格式（markdown）：
## Q1：{问题}
**A**：{答案}。[^N]

## Q2：...

要求：
- 问题要是真实业务方可能问的（避免"该文档讲了什么"这种空洞题）
- 答案 < 100 字，必须带 [^N] 引用
- 覆盖文档的不同方面，不要全集中在一处
- 中文输出（除非文档全是英文）`

/**
 * 入口：异步生成；调用方负责 INSERT row + setImmediate(fire)
 */
export async function executeArtifact(artifactId: number, kind: ArtifactKind): Promise<void> {
  const pool = getPgPool()
  await pool.query(
    `UPDATE notebook_artifact SET status = 'running' WHERE id = $1`,
    [artifactId],
  )

  try {
    // 1) 拿到归属 notebook + sources
    const { rows: rArt } = await pool.query(
      `SELECT notebook_id FROM notebook_artifact WHERE id = $1`,
      [artifactId],
    )
    if (!rArt[0]) throw new Error('artifact row missing')
    const notebookId = Number(rArt[0].notebook_id)

    const { rows: nbRow } = await pool.query(
      `SELECT name FROM notebook WHERE id = $1`,
      [notebookId],
    )
    const notebookName = String(nbRow[0]?.name ?? '未命名 Notebook')

    const { rows: srcRows } = await pool.query(
      `SELECT ns.asset_id, ma.name AS asset_name
       FROM notebook_source ns
       JOIN metadata_asset ma ON ma.id = ns.asset_id
       WHERE ns.notebook_id = $1
       ORDER BY ns.asset_id`,
      [notebookId],
    )
    if (srcRows.length === 0) throw new Error('notebook 无任何 source')

    // 2) 收集每个 source 的代表性内容（每个 asset 抽 3-5 个 top chunk）
    const sources: SourceContent[] = []
    for (const r of srcRows) {
      const aid = Number(r.asset_id)
      const name = String(r.asset_name)
      const text = await collectAssetContent(aid)
      if (text.trim()) sources.push({ asset_id: aid, asset_name: name, text })
    }
    if (sources.length === 0) throw new Error('所有 source 都没有可用 chunk')

    // 3) 拼 system prompt + context
    const promptHead = kind === 'briefing'
      ? PROMPT_BRIEFING.replace('{标题}', notebookName)
      : PROMPT_FAQ
    const ctx = sources
      .map((s, i) => `[${i + 1}] ${s.asset_name}\n${s.text}`)
      .join('\n\n---\n\n')

    const result = await chatComplete(
      [{ role: 'user', content: kind === 'briefing' ? '请生成简报。' : '请生成 FAQ。' }],
      { system: `${promptHead}\n\n# 文档：\n${ctx}`, maxTokens: 3000 },
    )
    const content = (result.content ?? '').trim()
    if (!content) throw new Error('LLM 返空')

    // 4) 写完成
    await pool.query(
      `UPDATE notebook_artifact
       SET status = 'done', content = $2, meta = $3::jsonb, finished_at = NOW()
       WHERE id = $1`,
      [
        artifactId,
        content,
        JSON.stringify({
          sources_snapshot: sources.map((s) => ({ asset_id: s.asset_id, asset_name: s.asset_name })),
          source_count: sources.length,
        }),
      ],
    )
  } catch (err) {
    await pool.query(
      `UPDATE notebook_artifact
       SET status = 'failed', error = $2, finished_at = NOW()
       WHERE id = $1`,
      [artifactId, err instanceof Error ? err.message : 'unknown'],
    )
  }
}

/**
 * 抽取一个 asset 的代表性内容：headings 全部 + samples 前 N
 * 控制单 asset 上下文长度，避免大文档把 prompt 撑爆
 */
async function collectAssetContent(assetId: number): Promise<string> {
  const pool = getPgPool()
  const { rows: headings } = await pool.query(
    `SELECT content FROM metadata_field
     WHERE asset_id = $1 AND chunk_level = 1
     ORDER BY chunk_index LIMIT 30`,
    [assetId],
  )
  const { rows: samples } = await pool.query(
    `SELECT content FROM metadata_field
     WHERE asset_id = $1 AND chunk_level = 3
     ORDER BY chunk_index LIMIT 8`,
    [assetId],
  )
  const parts = [
    ...headings.map((r) => `## ${String(r.content).trim()}`),
    ...samples.map((r) => String(r.content).trim()),
  ]
  // 限制单 asset ≤ 4000 字符（避免 prompt 过长；多 source 时尤其重要）
  let acc = ''
  for (const p of parts) {
    if (acc.length + p.length + 2 > 4000) break
    acc += (acc ? '\n\n' : '') + p
  }
  return acc
}

// silence unused warning for searchKnowledgeChunks (保留 import 供未来基于 query 的衍生品)
void searchKnowledgeChunks
