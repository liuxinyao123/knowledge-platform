# Design: rag-relevance-hygiene

## 1. 分数显示改造（A）

### 1.1 后端 · `ragPipeline.ts:189` emit 分桶

**当前**：
```ts
label: `Reranker 精排完成（前 5 分数：${ranked.slice(0, 5).map((r) => r.score.toFixed(2)).join(' / ')}）`
```
问题：`score = 0.0000166` → `toFixed(2) = "0.00"`，掩盖真实量级。

**新**：抽 `formatRelevanceScore(s)` 纯函数：

```ts
function formatRelevanceScore(s: number): string {
  if (!Number.isFinite(s)) return '—'
  if (s >= 0.5)  return s.toFixed(2)            // 高相关：0.99
  if (s >= 0.01) return s.toFixed(3)            // 中相关：0.049
  return s.toExponential(2)                     // 极低：1.66e-5
}
```

Label 格式不变，只是每个分数走新的 formatter。同时**把 top-1 原始分数写进 emit event 的 meta 字段**（非字符串）供前端额外消费。

### 1.2 前端 · 引用文档"置信度" pill

现在是 `score * 100 | 0 + '%'` 格式（推测），同样会把 0.0001 四舍五入成 0%。

**新规则**（同 `formatRelevanceScore` 的 UI 对等）：
| 分数 | pill 颜色 | 文案 |
|---|---|---|
| ≥ 0.5 | 绿 | "高相关 · N%" |
| 0.1–0.5 | 蓝 | "中相关 · N%" |
| 0.01–0.1 | 灰 | "弱相关 · <数字>" |
| < 0.01 | 红 | "几无相关 · <科学计数>" |

tooltip 始终显示原始小数分数。

## 2. 相关性阈值 WARN（B）

`ragPipeline.ts:178-191` rerank 成功后，加：

```ts
const top1 = ranked[0]?.score ?? 0
if (top1 < RELEVANCE_WARN_THRESHOLD) {     // 0.1
  emit({
    type: 'rag_step', icon: '⚠️',
    label: `检索结果相关性极低（top-1 = ${formatRelevanceScore(top1)}）。可能原因：`
         + `① 该问题库里没有相关文档 ② 文档质量差（OCR 碎片 / 入库异常）`
         + `③ 问法需要调整。建议检查 /assets 或换一种问法重试。`,
  })
}
```

阈值 `0.1` 写成常量 `RELEVANCE_WARN_THRESHOLD`，同时支持 `process.env.RAG_RELEVANCE_WARN_THRESHOLD` 覆盖（线上灵活调节）。

不阻断流程：即使 top-1 是 0.00001 也继续进 LLM（让模型按 system prompt "找不到就承认找不到"回复）。

## 3. 共享 OCR 碎片判别器（C · 前置）

把批 D 的 `looksLikeOcrFragment` 从 `services/tagExtract.ts` 抽到 `services/textHygiene.ts`（新文件）：

```ts
// services/textHygiene.ts
const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F]/u
const LOOSE_PUNCT_RE = /["'`\u201c\u201d\u2018\u2019]/

export function looksLikeOcrFragment(s: string): boolean {
  if (EMOJI_RE.test(s)) return true
  if (LOOSE_PUNCT_RE.test(s)) return true
  if (/^[A-Za-z0-9\s\-_/]+$/.test(s)) {
    const tokens = s.split(/\s+/).filter(Boolean)
    if (tokens.length >= 3) {
      const avg = tokens.reduce((a, t) => a + t.length, 0) / tokens.length
      if (avg < 2) return true
      const singles = tokens.filter((t) => t.length === 1).length
      if (singles >= 3) return true
    }
  }
  return false
}

export function looksLikeErrorJsonBlob(s: string): boolean {
  const t = s.trim()
  if (!t.startsWith('{')) return false
  return /"type"\s*:\s*"error"/.test(t)
    || /"error"\s*:\s*\{/.test(t)
    || /not_found_error/.test(t)
    || /File not found in container/.test(t)
}

export const MIN_CHUNK_CHARS = 20

/** 综合：chunk 是否值得入库 */
export function isBadChunk(content: string): { bad: boolean; reason?: string } {
  const c = content.trim()
  if (c.length < MIN_CHUNK_CHARS) return { bad: true, reason: 'too_short' }
  if (looksLikeErrorJsonBlob(c)) return { bad: true, reason: 'error_json_blob' }
  if (looksLikeOcrFragment(c))   return { bad: true, reason: 'ocr_fragment' }
  return { bad: false }
}
```

`tagExtract.ts` 改为 `import { looksLikeOcrFragment } from './textHygiene'`，删掉原重复定义。

## 4. ingest chunk gate（C）

`services/ingestPipeline/pipeline.ts:~156` 循环写 `metadata_field` 之前：

```ts
import { isBadChunk } from '../textHygiene.ts'

// ... 现有循环
let filteredCount = 0
const filterReasons: Record<string, number> = {}

for (let i = 0; i < result.chunks.length; i++) {
  const c = result.chunks[i]
  // 只对 L3（embed 粒度）做严过滤，L1（顶层）保留以备可视化
  if (chunkLevel(c.kind) === 3) {
    const check = isBadChunk(c.text)
    if (check.bad) {
      filteredCount++
      filterReasons[check.reason!] = (filterReasons[check.reason!] ?? 0) + 1
      continue   // 跳过这个 chunk，不 INSERT
    }
  }
  // ...原来 embed + INSERT 逻辑
}

if (filteredCount > 0) {
  // eslint-disable-next-line no-console
  console.log(`[ingest] filtered ${filteredCount} bad chunks (asset=${assetId}):`, filterReasons)
}
```

**注意**：L1（顶层概要）不过滤 —— 整篇资产的标题/目录也许短但仍有价值。只过滤 L3（被 embed 成向量用的细粒度 chunk）。

## 5. 一次性清库脚本（D）

### 5.1 外壳 `scripts/cleanup-bad-chunks.sh`

风格同 `scripts/permissions-v2-seed.sh`（bash + psql）：

```bash
#!/usr/bin/env bash
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-pg_db}"
PG_USER="${PG_USER:-knowledge}"
PG_DB="${PG_DB:-knowledge}"

MODE="dry-run"
[[ "${1:-}" == "--confirm" ]] && MODE="delete"

# 1) 先扫，报告命中分布
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 <<'SQL'
WITH bad AS (
  SELECT id, asset_id, LENGTH(content) AS len, content,
    CASE
      WHEN LENGTH(TRIM(content)) < 20 THEN 'too_short'
      WHEN content ~ '"type"\s*:\s*"error"|"error"\s*:\s*\{|not_found_error|File not found in container' THEN 'error_json'
      WHEN content ~ '["'']'  THEN 'loose_punct'
      ELSE 'ok'
    END AS reason
  FROM metadata_field
  WHERE chunk_level = 3
)
SELECT reason, COUNT(*) AS rows, COUNT(DISTINCT asset_id) AS assets
FROM bad WHERE reason <> 'ok'
GROUP BY reason ORDER BY rows DESC;
SQL

if [[ "$MODE" == "dry-run" ]]; then
  echo "(dry-run 模式；追加 --confirm 实际 DELETE)"
  exit 0
fi

# 2) 实际 DELETE
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM metadata_field
WHERE chunk_level = 3 AND (
  LENGTH(TRIM(content)) < 20
  OR content ~ '"type"\s*:\s*"error"|"error"\s*:\s*\{|not_found_error|File not found in container'
);
SELECT 'done';
SQL
```

**限制**：
- SQL regex 能识别"短 chunk"和"JSON error"；但"OCR 碎片"（emoji / 单字符 token ≥3）用 PG regex 表达复杂，**不在脚本 DELETE 范围**；这类需要导出到 Node 脚本跑 `isBadChunk` 判断
- 脚本不处理 re-embed；受影响 asset 需要重跑 ingest（ `POST /api/ingest/upload-full` 重入）或由后续 batch job

### 5.2 辅助 Node 脚本 `scripts/cleanup-bad-chunks-ocr.mjs`

对 OCR 碎片类做精细判定（PG regex 搞不定的）：
- 连 PG，`SELECT id, content FROM metadata_field WHERE chunk_level=3`
- 对每行跑 `isBadChunk`（import 从 qa-service）
- `--confirm` 才 DELETE

保持 **D 和 C 代码共享同一个 `isBadChunk`**，不分叉。

## 6. chatStream 空流守护（D3）

`services/llm.ts:128-166`：

```ts
export async function* chatStream(...): AsyncGenerator<string> {
  // ... 前置 llmFetch

  let yielded = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      // ... 现有解析
      if (text) { yielded++; yield text }
    }
  } catch (e) {
    throw new Error(`LLM stream interrupted: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    try { reader.releaseLock() } catch { /* noop */ }
  }

  if (yielded === 0) {
    throw new Error('LLM stream returned no content chunks (upstream returned empty stream or closed immediately)')
  }
}
```

ragPipeline 里 `for await (const text of stream)` 的 throw 会冒泡到 `dispatchHandler` 的 catch，emit `error` event。用户**不会再看到静默截断**。

## 7. 约束

- **A 不破坏 trace 结构**：emit event 的 `label` 字段是字符串没变，前端不动也能显示
- **B 不阻塞请求**：阈值 WARN 只是 `rag_step` event，不影响 `content` / `done` 流
- **C 不动 pgvector schema**：只在应用层加 gate；DB 不需要 migration
- **D 默认 dry-run**：误删代价高；只有 `--confirm` 才 DELETE
- **D3 不重试**：空流直接 throw；重试策略留给后续 observability change

## 8. 未覆盖 · H3 的走向

EventStream 信号决定：

- 若 LLM **真的就吐"知识"两字**（`data: {..."delta":{"content":"知识"}}` 一次 + `[DONE]`）→ 根因是 **LLM 本身短回答**（可能被 system prompt 过严 + context 毒化共同作用）。修法：改 system prompt，当 retrieve top-1 < 0.1 时切换到"礼貌回复 + 建议换问法"的分支，而不是进正常 RAG prompt
- 若 LLM **吐了十几个 delta 但前端只渲染了前两字** → 前端 state 管理 bug，单独改 QA / Agent 两处
- 若 **SSE 中途断**（上游 close）→ D3 的空流守护变形：检测到 stream premature close 时 emit error 带具体原因

上面三条都是**独立 change**，不在本轮 scope。本轮 D3 只做"完全空流"这一种最直观的防御。
