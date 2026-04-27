#!/usr/bin/env bash
#
# scripts/_split-and-push.sh
#
# 把当前工作树（ADR-34 v3 + ADR-35 + ADR-44 三组改动混在一起）拆成 3 个原子 commit + push。
# 沙箱跑过 commit 1 但 .git/index.lock 卡死，剩余 amend + 2/3 + push 在你 Mac 上一次跑完。
#
# 用法：
#   bash scripts/_split-and-push.sh
#
# 安全：每一步都打印将要做什么；任意错误都 set -e 立即退出，不留半成品。
# 跑完成功后这个脚本可以删掉（一次性工具）。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "═══════════════════════════════════════════════════════"
echo "  Step 0 · Pre-flight"
echo "═══════════════════════════════════════════════════════"

# 沙箱遗留的所有 .lock 文件（index.lock / HEAD.lock / refs/heads/main.lock 都可能撞）
LEFTOVERS=$(find .git -name "*.lock" 2>/dev/null)
if [ -n "$LEFTOVERS" ]; then
  echo "  → 发现 .git 内残留 lock 文件（沙箱遗留），全部删除："
  echo "$LEFTOVERS" | sed 's/^/      /'
  find .git -name "*.lock" -delete
fi

# 保证当前 HEAD 是 commit 1（ADR-34）
LAST_MSG=$(git log -1 --format="%s")
if [[ "$LAST_MSG" != ADR-34* ]]; then
  echo "  ✗ HEAD 不是 ADR-34 commit。当前 HEAD: $LAST_MSG"
  echo "    请先确认沙箱跑过的 commit 1 还在；不在的话重新跑一遍 add+commit ADR-34 文件再来。"
  exit 1
fi
echo "  ✓ HEAD = $LAST_MSG"

# Explore specs 目录如果还在，顺手删掉（已归档到 archive/asset-vector-coloc/）
if [ -d "docs/superpowers/specs/pgvector-modernization" ]; then
  echo "  → 删除已归档的 explore specs 目录"
  rm -rf docs/superpowers/specs/pgvector-modernization
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Step 1 · Amend commit 1 with ADR-34 v3 frontend follow-ups"
echo "═══════════════════════════════════════════════════════"

git add \
  apps/qa-service/src/routes/assetDirectory.ts \
  apps/web/src/api/assetDirectory.ts \
  apps/web/src/knowledge/Assets/DetailAssets.tsx \
  apps/web/src/knowledge/Assets/DetailGraph.tsx

git commit --amend -m "ADR-34: hot-fix ingest race + AGE Cypher | alternation + xlsx empty rows + asset detail UI

Backend bug fixes:
- ingest race condition: fire-and-forget INSERT vs UPDATE bytes_ref → UPSERT
  (ON CONFLICT DO UPDATE) in enqueueIngestJob; defensive worker filter
  (kind='abstract' OR bytes_ref IS NOT NULL) in claimOne
- AGE 1.6 Cypher [r:CITED|CO_CITED] syntax error → split into two
  single-relation MATCHes, app-level merge
- xlsx empty-row AST: officeparser yields heading chunks but 0 paragraphs;
  add SheetJS (xlsx pkg from official CDN tarball) as secondary fallback

Frontend follow-up (ADR-34 v3 同批):
- assetDirectory pg-assets/:id/detail SQL 从 chunk_level=1 改 IN (1, 3)
  → 把 SheetJS 兜底产生的 paragraph chunk 一并暴露给详情面板
- DetailAssets.tsx 区分 heading vs paragraph 渲染（badge + 截断 tooltip）
- DetailGraph.tsx 视觉重做（同日附带）：节点按 kind 分色、边 hover 标签、
  背景 radial gradient

ADR: .superpowers-memory/decisions/2026-04-26-34-ingest-bytes-ref-race-fix.md"

echo "  ✓ commit 1 amended → $(git log -1 --format='%h %s')"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Step 2 · Stash ADR-44 hunks in 3 overlap files (working tree → ADR-35-only state)"
echo "═══════════════════════════════════════════════════════"

# 用 Node 做精准 find/replace（多行模式 sed 不可靠）
node --no-warnings <<'NODE_EOF'
import { readFileSync, writeFileSync } from 'node:fs'

function patch(path, find, replace) {
  const buf = readFileSync(path, 'utf8')
  if (!buf.includes(find)) {
    console.error(`  ✗ pattern not found in ${path}`)
    process.exit(1)
  }
  writeFileSync(path, buf.replace(find, replace), 'utf8')
  console.log(`  ✓ patched ${path}`)
}

// ragTypes.ts: 移除 Citation 中的 image_id / image_url
patch(
  'apps/qa-service/src/ragTypes.ts',
  `export interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
  /**
   * asset-vector-coloc：来源 chunk 是 kind='image_caption' 时回填的图片 id。
   * 老客户端忽略未知字段即可（v1.x 反序列化兼容）。
   */
  image_id?: number
  /**
   * asset-vector-coloc：后端拼装的图片预览 URL（默认 \`/api/assets/images/\${image_id}\`）。
   * 由后端集中收口，前端无需自行推导。env CITATION_IMAGE_URL_ENABLED=false 时不回填。
   */
  image_url?: string
}`,
  `export interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
}`,
)

// ragPipeline.ts: toCitation 还原成原始版本（去掉 isCitationImageEnabled + 图字段回填）
patch(
  'apps/qa-service/src/services/ragPipeline.ts',
  `// ── 辅助：AssetChunk → Citation ──────────────────────────────────────────────

/**
 * asset-vector-coloc · 是否在 Citation 中回填 image_id / image_url。
 * 默认 on；env CITATION_IMAGE_URL_ENABLED=false 时关闭，前端自动退回纯文本。
 */
function isCitationImageEnabled(): boolean {
  const v = (process.env.CITATION_IMAGE_URL_ENABLED ?? 'true').toLowerCase().trim()
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no')
}

/** asset-vector-coloc：导出供单测断言；其它内部调用方仍走同一份。 */
export function toCitation(doc: AssetChunk, index: number): Citation {
  const cite: Citation = {
    index,
    asset_id: doc.asset_id,
    asset_name: doc.asset_name,
    chunk_content: String(doc.chunk_content).slice(0, 500),
    score: doc.score,
  }
  // asset-vector-coloc：来源 chunk 是 image_caption 行 → 透出图字节回查链接
  if (
    isCitationImageEnabled() &&
    doc.kind === 'image_caption' &&
    typeof doc.image_id === 'number' &&
    doc.image_id > 0
  ) {
    cite.image_id = doc.image_id
    cite.image_url = \`/api/assets/images/\${doc.image_id}\`
  }
  return cite
}`,
  `// ── 辅助：AssetChunk → Citation ──────────────────────────────────────────────

function toCitation(doc: AssetChunk, index: number): Citation {
  return {
    index,
    asset_id: doc.asset_id,
    asset_name: doc.asset_name,
    chunk_content: String(doc.chunk_content).slice(0, 500),
    score: doc.score,
  }
}`,
)

// QA/index.tsx · 同 ragTypes，移除 Citation 中的两行
patch(
  'apps/web/src/knowledge/QA/index.tsx',
  `interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
  /** asset-vector-coloc：来源 chunk 是 image_caption 时回填 */
  image_id?: number
  image_url?: string
}`,
  `interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
}`,
)

// QA/index.tsx · 移除 citation 缩略图渲染块
patch(
  'apps/web/src/knowledge/QA/index.tsx',
  `                      }}>{c.index}</span>
                      {c.asset_name}
                    </div>
                    {c.image_url && (
                      <div style={{ margin: '6px 0' }}>
                        <img
                          src={c.image_url}
                          alt={c.chunk_content.slice(0, 40)}
                          data-testid="citation-thumbnail"
                          style={{
                            width: 64, height: 64, objectFit: 'cover',
                            borderRadius: 4, border: '1px solid var(--border)',
                          }}
                          loading="lazy"
                        />
                      </div>
                    )}
                    <div className="result-snippet">`,
  `                      }}>{c.index}</span>
                      {c.asset_name}
                    </div>
                    <div className="result-snippet">`,
)
NODE_EOF

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Step 3 · Commit 2 · ADR-35 qa-web-search-and-multimodal"
echo "═══════════════════════════════════════════════════════"

git add \
  apps/qa-service/src/services/webSearch.ts \
  apps/qa-service/src/agent/types.ts \
  apps/qa-service/src/agent/dispatchHandler.ts \
  apps/qa-service/src/agent/agents/KnowledgeQaAgent.ts \
  apps/qa-service/src/services/ragPipeline.ts \
  apps/qa-service/src/ragTypes.ts \
  apps/web/src/knowledge/QA/index.tsx \
  apps/qa-service/.env.example \
  infra/docker-compose.yml \
  .superpowers-memory/decisions/2026-04-26-35-qa-web-search-and-multimodal.md

git commit -m "ADR-35: QA web search + multimodal image attachment

QA composer 的 🌐 / 🖼 两个按钮从占位升级为真功能（全栈 e2e）：

🌐 联网检索（webSearch）:
- 新增 services/webSearch.ts（Tavily 优先 / Bing 备选 / none 默认）
- agent/dispatch 接 web_search; KnowledgeQaAgent → runRagPipeline({webSearch})
- ragPipeline 在 generateAnswer 之前调 webSearch；结果作 [w1..wN] 拼进
  LLM context（与文档 [N] 区分），emit 新事件 web_step
- env: WEB_SEARCH_PROVIDER=tavily|bing|none + 对应 *_API_KEY
- 默认 none（私有部署不外发；用户显式配 key 才启用）

🖼 多模态 QA（image）:
- 复用已部署的 Qwen2.5-VL-72B-Instruct（INGEST_VLM_MODEL，PDF v2 已在用）
- agent/dispatch 接 image: { base64, mimeType }; 上限 6MB 前 / 8MB base64 后
- ragPipeline.generateAnswer 当 extras.image 存在时切到 VLM 模型，
  user message 走 ContentBlock[]（OpenAI 兼容）
- 前端 file picker → FileReader → 缩略图 chip + 移除按钮

兼容：老客户端不传 web_search/image 时行为完全不变；SseEvent 加 web_step
旧前端忽略未知 type。
私有内网部署：env=none 时前端 toggle 仍可点，后端 emit warn 跳过。

Files:
- apps/qa-service/src/services/webSearch.ts (new)
- apps/qa-service/src/agent/{types,dispatchHandler,agents/KnowledgeQaAgent}.ts
- apps/qa-service/src/services/ragPipeline.ts (extras / RunRagOptions / web_step)
- apps/qa-service/src/ragTypes.ts (WebStepPayload + web_step SseEvent)
- apps/web/src/knowledge/QA/index.tsx (toggle + file picker + image preview chip)
- apps/qa-service/.env.example (6 个 WEB_SEARCH_* 变量)
- infra/docker-compose.yml (qa_service 注入)

ADR: .superpowers-memory/decisions/2026-04-26-35-qa-web-search-and-multimodal.md"

echo "  ✓ commit 2 done → $(git log -1 --format='%h %s')"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Step 4 · Re-apply ADR-44 hunks to 3 overlap files (working tree → full state)"
echo "═══════════════════════════════════════════════════════"

node --no-warnings <<'NODE_EOF'
import { readFileSync, writeFileSync } from 'node:fs'

function patch(path, find, replace) {
  const buf = readFileSync(path, 'utf8')
  if (!buf.includes(find)) {
    console.error(`  ✗ pattern not found in ${path} (re-apply phase)`)
    process.exit(1)
  }
  writeFileSync(path, buf.replace(find, replace), 'utf8')
  console.log(`  ✓ re-applied ${path}`)
}

// 反向：ragTypes.ts 加回 image_id / image_url
patch(
  'apps/qa-service/src/ragTypes.ts',
  `export interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
}`,
  `export interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
  /**
   * asset-vector-coloc：来源 chunk 是 kind='image_caption' 时回填的图片 id。
   * 老客户端忽略未知字段即可（v1.x 反序列化兼容）。
   */
  image_id?: number
  /**
   * asset-vector-coloc：后端拼装的图片预览 URL（默认 \`/api/assets/images/\${image_id}\`）。
   * 由后端集中收口，前端无需自行推导。env CITATION_IMAGE_URL_ENABLED=false 时不回填。
   */
  image_url?: string
}`,
)

// 反向：ragPipeline.ts 加回 isCitationImageEnabled + 重写 toCitation
patch(
  'apps/qa-service/src/services/ragPipeline.ts',
  `// ── 辅助：AssetChunk → Citation ──────────────────────────────────────────────

function toCitation(doc: AssetChunk, index: number): Citation {
  return {
    index,
    asset_id: doc.asset_id,
    asset_name: doc.asset_name,
    chunk_content: String(doc.chunk_content).slice(0, 500),
    score: doc.score,
  }
}`,
  `// ── 辅助：AssetChunk → Citation ──────────────────────────────────────────────

/**
 * asset-vector-coloc · 是否在 Citation 中回填 image_id / image_url。
 * 默认 on；env CITATION_IMAGE_URL_ENABLED=false 时关闭，前端自动退回纯文本。
 */
function isCitationImageEnabled(): boolean {
  const v = (process.env.CITATION_IMAGE_URL_ENABLED ?? 'true').toLowerCase().trim()
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no')
}

/** asset-vector-coloc：导出供单测断言；其它内部调用方仍走同一份。 */
export function toCitation(doc: AssetChunk, index: number): Citation {
  const cite: Citation = {
    index,
    asset_id: doc.asset_id,
    asset_name: doc.asset_name,
    chunk_content: String(doc.chunk_content).slice(0, 500),
    score: doc.score,
  }
  // asset-vector-coloc：来源 chunk 是 image_caption 行 → 透出图字节回查链接
  if (
    isCitationImageEnabled() &&
    doc.kind === 'image_caption' &&
    typeof doc.image_id === 'number' &&
    doc.image_id > 0
  ) {
    cite.image_id = doc.image_id
    cite.image_url = \`/api/assets/images/\${doc.image_id}\`
  }
  return cite
}`,
)

// 反向：QA/index.tsx · Citation 接口加回两行
patch(
  'apps/web/src/knowledge/QA/index.tsx',
  `interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
}`,
  `interface Citation {
  index: number
  asset_id: number
  asset_name: string
  chunk_content: string
  score: number
  /** asset-vector-coloc：来源 chunk 是 image_caption 时回填 */
  image_id?: number
  image_url?: string
}`,
)

// 反向：QA/index.tsx · citation 缩略图渲染块
patch(
  'apps/web/src/knowledge/QA/index.tsx',
  `                      }}>{c.index}</span>
                      {c.asset_name}
                    </div>
                    <div className="result-snippet">`,
  `                      }}>{c.index}</span>
                      {c.asset_name}
                    </div>
                    {c.image_url && (
                      <div style={{ margin: '6px 0' }}>
                        <img
                          src={c.image_url}
                          alt={c.chunk_content.slice(0, 40)}
                          data-testid="citation-thumbnail"
                          style={{
                            width: 64, height: 64, objectFit: 'cover',
                            borderRadius: 4, border: '1px solid var(--border)',
                          }}
                          loading="lazy"
                        />
                      </div>
                    )}
                    <div className="result-snippet">`,
)
NODE_EOF

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Step 5 · Commit 3 · ADR-44 asset-vector-coloc (LanceDB 借鉴)"
echo "═══════════════════════════════════════════════════════"

# 把所有剩下的（包括 untracked）一起 add
git add -A

git commit -m "ADR-44: LanceDB 借鉴评估落地 · asset-vector-coloc + halfvec opt-in

走完 B 工作流四步（Explore → Lock → Execute → Archive），LanceDB 借鉴评估
最终交付：

✅ Item 2 · Citation 透图（生产可用）
- ragTypes.ts: Citation 加可选 image_id?: number / image_url?: string
- knowledgeSearch.ts: retrieval SQL SELECT 列表加 kind / image_id；
  AssetChunk 接口加同名两字段
- ragPipeline.ts: toCitation 在 kind='image_caption' && image_id>0 时
  回填 image_id + image_url（走 /api/assets/images/:id 已有路由）
- env CITATION_IMAGE_URL_ENABLED=true 默认；可关
- 前端三处 Citation 渲染加 64×64 缩略图（QA / Agent / Notebooks ChatPanel）+
  api/notebooks.ts Citation 接口同步加字段

✅ Item 1 · halfvec 迁移代码（默认 OFF · opt-in）
- pgDb.ts: migrateToHalfvec()；三层兜底（flag/版本/列已 halfvec）+ 幂等
  ALTER + 重建 IVFFlat halfvec_cosine_ops
- env PGVECTOR_HALF_PRECISION=false 默认；显式 true 才迁。
  默认 OFF 理由（ADR-44 §D-003 详）：
  · halfvec 在 GM-LIFTGATE32 实测把 Q26/Q32 borderline 题候选从 5 切到 0
    （fp16 在 4096-d cosine 上把 ~0.51 压到 ~0.49，跌过 MIN_SCORE）
  · 30 MB / 2k 行 corpus 上节省 ~14 MB，不抵风险
- scripts/rollback-halfvec.mjs: 紧急回滚（dry-run 默认 / --commit 实跑）
- 单测 17 case 全绿（citationImage 8 + halfvecMigration 9）

🚫 Deferred to OQ（写进 .superpowers-memory/open-questions.md）
- OQ-VEC-QUANT-V2: halfvec/binary quantization/pgvectorscale 重启前置
  （rows > 50k OR size > 200MB OR P95 > 100ms；且必须先解决 MIN_SCORE
  adaptive 或 reranker 兜底）
- OQ-CAPTION-DUAL-EMBED: caption_embedding 单独一列（异构模型驱动）
- OQ-EVAL-RECALL-DRIFT: recall@5 1.000→0.865 基线漂移追查
  （4 配置实测一致 0.865，与本 change 完全无关；归独立 change 处理）

LanceDB 借鉴对照表完整存档于 ADR-44，与 ADR-39 (WeKnora) 同款方法论。

Files (16 modified + 7 new):
- apps/qa-service/src/{ragTypes,services/{pgDb,knowledgeSearch,ragPipeline,
  l0Filter}}.ts
- apps/qa-service/src/__tests__/{citationImage,halfvecMigration}.test.ts (new)
- apps/web/src/{api/notebooks,knowledge/{QA,Agent,Notebooks/ChatPanel}}*.ts
- scripts/rollback-halfvec.mjs (new)
- openspec/changes/asset-vector-coloc/ (new · proposal/design/specs/tasks)
- docs/superpowers/archive/asset-vector-coloc/design.md (new)
- .superpowers-memory/{integrations,open-questions}.md
- .superpowers-memory/decisions/2026-04-27-44-lance-borrowing-asset-vector-coloc.md (new)
- .superpowers-memory/PROGRESS-SNAPSHOT-2026-04-27-asset-vector-coloc.md (new)

ADR: .superpowers-memory/decisions/2026-04-27-44-lance-borrowing-asset-vector-coloc.md"

echo "  ✓ commit 3 done → $(git log -1 --format='%h %s')"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Step 6 · Push to origin/main"
echo "═══════════════════════════════════════════════════════"

git log --oneline -3
echo ""
echo "  → git push origin main"
git push origin main

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ 完成。本脚本一次性工具，可删："
echo "     rm scripts/_split-and-push.sh"
echo "═══════════════════════════════════════════════════════"
