# Spec: ingest-l0-abstract

> 行为契约。每个 Scenario 形如 BDD：Given/Then/And。执行阶段单测应一一对应。

## chunk_abstract 表

**Scenario: 新装机自动建表**
- Given 干净 pgvector 实例
- When `runPgMigrations()` 跑完
- Then `chunk_abstract` 表存在
- And 含字段 id / chunk_id / asset_id / l0_text / l0_embedding / l1_text / generator_version / generated_at
- And UNIQUE 约束在 chunk_id
- And `idx_chunk_abstract_l0_embedding` 索引存在（IVFFLAT）

**Scenario: 升级机重复跑迁移**
- Given chunk_abstract 已存在
- When `runPgMigrations()` 再跑
- Then 不报错
- And 表结构不变

**Scenario: chunk 删除级联**
- Given chunk_abstract 行 (chunk_id=42)
- When `DELETE FROM metadata_field WHERE id=42`
- Then chunk_abstract 对应行也被删除（ON DELETE CASCADE）

## generateAbstractsForAsset

**Scenario: disabled 时整段 no-op**
- Given `L0_GENERATE_ENABLED=false`
- When `generateAbstractsForAsset(123, pool)` 调用
- Then 立即返回 `{generated:0, failed:0, skipped:0}`
- And 不查 metadata_field
- And 不调 chatComplete

**Scenario: 已生成的 chunk 不重复**
- Given asset 123 有 5 个 chunk，其中 2 个已在 chunk_abstract 表
- When `generateAbstractsForAsset(123, pool)`
- Then 只对 3 个未生成的调 chatComplete
- And 返回 `{generated:3, failed:0, skipped:0}`（假设全部成功）

**Scenario: 短 chunk 跳过**
- Given chunk 内容长度 < `L0_GENERATE_MIN_CHARS`（默认 60）
- When `generateAbstractsForAsset` 处理到此 chunk
- Then 该 chunk 计入 skipped
- And 不调 chatComplete

**Scenario: LLM 抛异常单条**
- Given `chatComplete` 对某个 chunk 抛 NetworkError
- When `generateAbstractsForAsset` 处理
- Then 该 chunk 计入 failed
- And 不抛到调用方
- And 其他 chunk 正常处理

**Scenario: JSON 解析失败**
- Given `chatComplete` 返回 `'not a json'`
- When 解析
- Then 计入 failed，不抛

**Scenario: l0 长度违规丢弃**
- Given `chatComplete` 返回 `{l0: '一句话超长'×100, l1: '...'}`（l0 > 200 字）
- When 解析
- Then 计入 failed，不写入 chunk_abstract

**Scenario: 成功路径**
- Given chunk content "知识图谱是一种结构化语义网络..."
- And `chatComplete` 返回合法 JSON `{l0:'知识图谱是XX', l1:'结论:...'}`
- When `generateAbstractsForAsset` 处理
- Then `embedTexts(['知识图谱是XX'])` 被调用一次
- And `INSERT INTO chunk_abstract (...)` 一行
- And 返回 `{generated:1, failed:0, skipped:0}`

## runPipeline 集成

**Scenario: ingest 走完包含 abstract phase**
- Given `L0_GENERATE_ENABLED=true`
- And ingest 一份正常 markdown
- When pipeline 跑完
- Then progress 回调被调用至少 5 次（parse/chunk/tag/embed/abstract/done）
- And `chunk_abstract` 表有该 asset 的行

**Scenario: abstract 失败不阻断 ingest**
- Given `L0_GENERATE_ENABLED=true` 但硅基 LLM key 失效
- When ingest 一份 PDF
- Then ingest 完成（metadata_asset / metadata_field 都写入）
- And `chunk_abstract` 表无新增（或部分）
- And ingest_done 日志 `abstract_failed > 0`

## coarseFilterByL0

**Scenario: disabled 返回 undefined**
- Given `L0_FILTER_ENABLED=false`
- When `coarseFilterByL0('question', emit, {})`
- Then 立即返回 undefined
- And 不查 chunk_abstract

**Scenario: 表空返回 undefined**
- Given chunk_abstract 表 0 行
- And `L0_FILTER_ENABLED=true`
- When `coarseFilterByL0(...)`
- Then 返回 undefined（不是 []）
- And 调用方走原路径不 emit

**Scenario: 0 命中返回 []**
- Given chunk_abstract 有 100 行但语义都和 question 无关
- When `coarseFilterByL0(...)`
- Then 返回 `[]`
- And emit 一个 warn `L0 粗筛 0 命中，回退原路径`

**Scenario: 命中返回 asset_ids**
- Given chunk_abstract 有命中
- When `coarseFilterByL0(...)`
- Then 返回 distinct asset_id 列表，长度 ≤ `L0_FILTER_TOP_ASSETS`
- And emit `🧰 L0 粗筛：N 个候选 asset`

**Scenario: spaceId / sourceIds 下推**
- Given opts.spaceId=5
- When `coarseFilterByL0(...)`
- Then SQL where 含 source_id IN (space 5 的 source 集)

## ragPipeline 集成

**Scenario: L0 命中 → asset_ids 注入**
- Given `coarseFilterByL0` 返回 `[7, 11, 19]`
- When retrieveInitial 调用
- Then 参数 assetIds = [7, 11, 19]

**Scenario: L0 返回 undefined → 原路径**
- Given `coarseFilterByL0` 返回 undefined
- When retrieveInitial 调用
- Then 参数无 assetIds（或 assetIds undefined）
- And rag_step 不 emit `🧰 L0 粗筛`

**Scenario: trace 字段**
- Given L0_FILTER_ENABLED=true 且命中 5 个 asset
- When 整条流程跑完
- Then trace.l0_filter_used === true
- And trace.l0_candidate_count === 5

## lazy 回填

**Scenario: enqueue 写 ingest_job**
- Given `L0_LAZY_BACKFILL_ENABLED=true`
- And rerank 后 candidate 中 chunk 100 / 200 / 300 缺 L0
- When ragPipeline rerank 完毕
- Then ingest_job 表新增一行 kind='abstract' status='queued' payload.chunk_ids=[100,200,300]

**Scenario: worker 取走并生成**
- Given ingest_job 一行 kind='abstract' payload.chunk_ids=[100,200,300]
- When ingestWorker 心跳
- Then 调 `generateAbstractsForChunks([100,200,300], pool)`
- And 完成后 status='indexed'
- And chunk_abstract 表新增 3 行（假设全部成功）

**Scenario: lazy disabled 不 enqueue**
- Given `L0_LAZY_BACKFILL_ENABLED=false`
- When ragPipeline rerank 完毕（candidate 缺 L0）
- Then ingest_job 表无新增

## active backfill 脚本

**Scenario: dry-run 不写库**
- Given chunk_abstract 表 0 行；metadata_field 1000 行
- When `node scripts/backfill-l0.mjs --dry-run --limit 100`
- Then 输出预估行数
- And chunk_abstract 表仍 0 行

**Scenario: 实跑写库**
- Given 同上初始状态
- When `node scripts/backfill-l0.mjs --limit 100`
- Then chunk_abstract 表新增 100 行（假设 LLM 全成功）

**Scenario: 断点续跑**
- Given 上次跑到 chunk_id=550 后崩溃
- And `.backfill-l0.cursor` 文件含 `550`
- When `node scripts/backfill-l0.mjs` 再跑
- Then 从 chunk_id=551 开始

## 兼容性 / 降级

**Scenario: 老客户端**
- Given 前端没升级（不识别 trace.l0_filter_used）
- When 后端 emit trace
- Then 前端忽略未知字段，正常渲染

**Scenario: chunk_abstract 表损坏 / pgvector 索引坏**
- Given coarseFilterByL0 SQL 抛
- When ragPipeline 调用
- Then 视为 undefined，走原路径
- And emit 一次结构化 WARN（每分钟最多一次）

**Scenario: 三 flag 全关 = baseline**
- Given `L0_GENERATE_ENABLED=false` `L0_FILTER_ENABLED=false` `L0_LAZY_BACKFILL_ENABLED=false`
- When ingest + RAG 全流程
- Then 行为字节级等同未引入本 change（除了 chunk_abstract 表存在但不被读写）
