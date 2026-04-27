# Integrations — 跨服务对接真相源

> 本文件列出外部系统的实际入口、凭据来源与 owner。
> 任何新增/变更对接方式必须同步更新本表，并在 `decisions/` 留下 ADR。

## BookStack

- 位置：`infra/docker-compose.yml` 中的 `bookstack` 服务（见 `infra/bookstack_data/`）
- API Base：`http://localhost:6875/api`
- 凭据：
  - 读写：`BOOKSTACK_TOKEN`（qa-service 用）
  - 只读：`BOOKSTACK_MCP_TOKEN`（mcp-service 用，独立账号）
- 相关 change：
  - `openspec/changes/rbac-access-control/`（角色写回 BookStack）
  - `openspec/changes/mcp-service/`（只读搜索 + 页面读取）

## MySQL（BookStack 同实例）

- 容器：`infra/mysql_data/`
- 新增平台自有表：
  - `knowledge_user_roles`
  - `knowledge_shelf_visibility`
- 连接方式：qa-service 通过 `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS` 环境变量
- 迁移策略：服务启动时 `CREATE TABLE IF NOT EXISTS`（轻量迁移）

## PostgreSQL + pgvector

- 容器：`infra/pg_data/`
- 用途：资产元数据目录向量检索
- 实际版本：**pgvector 0.8.2**（2026-04-27 实测）→ halfvec / binary quantization 双双就绪
- 向量列：
  - `metadata_field.embedding vector(4096)` — Qwen3-Embedding-8B 默认（生产路径）
  - `chunk_abstract.l0_embedding vector(4096)` — L0 abstract（同维）
- **可选 halfvec 迁移**（ADR-44 锁定 · 默认 OFF）：env `PGVECTOR_HALF_PRECISION=true` → `runPgMigrations` 内部 `migrateToHalfvec()` 把上述两列改 halfvec(4096) 并重建 IVFFlat 索引为 `halfvec_cosine_ops`；幂等。回滚走 `node --experimental-strip-types scripts/rollback-halfvec.mjs --commit`
- 相关 change：`openspec/changes/metadata-catalog-pgvector/`、`openspec/changes/asset-vector-coloc/`

## Citation 透图（asset-vector-coloc · 2026-04-27 上线）

- 入口：`apps/qa-service/src/services/ragPipeline.ts#toCitation()`
- 字段：`Citation` 接口新增可选 `image_id?: number` / `image_url?: string`（向后兼容；老客户端忽略未知字段）
- 触发：来源 chunk `kind='image_caption'` 且 `image_id > 0` 时回填 `image_url = /api/assets/images/${image_id}`
- 后端依赖：`metadata_field.image_id → metadata_asset_image.file_path → infra/asset_images/{assetId}/`，路由 `/api/assets/images/:imageId`（assetDirectory.ts，已有）
- Feature Flag：`CITATION_IMAGE_URL_ENABLED=true` 默认；关 → 不回填，前端自动退回纯文本
- 前端消费方：`apps/web/src/knowledge/QA/index.tsx` / `Agent/index.tsx` / `Notebooks/ChatPanel.tsx`，三处独立 Citation 接口已同步加字段，渲染 64×64（hover 卡片 96×96）缩略图
- 相关 ADR：`decisions/2026-04-27-44-lance-borrowing-asset-vector-coloc.md`

## Unified Auth Gateway

- 落点：qa-service 进程内中间件 `src/auth/`
- Token 双栈（二选一 env 配置）：
  - `AUTH_JWKS_URL`：JWKS 远端（OIDC / Keycloak / Auth0）
  - `AUTH_HS256_SECRET`：本地 HS256 对称密钥
- 生产 fail-fast：`NODE_ENV=production` 且两者皆空 → 启动退出
- 本地开发：未配置则 DEV BYPASS，所有请求注入 `{user_id:0, email:'dev@local', roles:['admin']}`
- 规则源：`metadata_acl_rule`（pgvector DB）；启动时 preload + Admin API 写后自动 reload
- 角色源：`knowledge_user_roles`（BookStack MySQL）
- 已接入中间件的路由：`/api/qa/ask`、`/api/knowledge/search`、`/api/acl/*`
- Admin API：`GET/POST/PUT/DELETE /api/acl/rules`、`POST /api/acl/cache/flush`（仅 ADMIN）
- 相关 ADR：`.superpowers-memory/decisions/2026-04-21-02-unified-auth-gateway.md`

## Ingest Pipeline 统一入口

- 入口：`services/ingestPipeline/index.ts#ingestDocument({buffer, name, sourceId, principal, opts})`
- **所有 ingest 端点**都通过它：`/api/knowledge/ingest`、`/api/ingest/scan-folder`（S3 BookStack sync 留待下一轮）
- 路由：按扩展名分发到 extractor
  - `.pdf` → pdfPipeline v2（ODL + VLM）
  - `.docx` → mammoth 段落
  - `.pptx / .ppt / .xlsx / .xls` → officeparser
  - `.md / .html / .htm / .markdown` → heading-aware 解析
  - `.txt / .csv` → 原样
  - `.png / .jpg / .jpeg` → 单图 VLM
  - 未知 → plaintext 兜底 + warning
- 后处理：metadata_asset → 图片落档+caption → metadata_field（带 kind/page/bbox/heading_path/image_id）→ embed → tags
- 鉴权：`requireAuth + enforceAcl({action:'WRITE', source_id})` 已挂在 /ingest 端点
- 可观测：每次完成 emit `event:'ingest_done'` 结构化日志（assetId / extractorId / chunks / images / duration_ms / warnings）
- 相关 ADR：`.superpowers-memory/decisions/2026-04-21-08-ingest-pipeline-unify.md`

## PDF Pipeline v2 (opendataloader + VLM)

- 触发：上传 `.pdf`（其它格式仍走 mammoth/officeparser）
- 解析引擎：`@opendataloader/pdf` (Java CLI，软依赖动态 import)
- 启动检查：`java -version` 探测；缺失则降级到 PDFParse v2 平文本
- 输出：结构化 chunks（heading/paragraph/table）+ 图片落档
- 图片存盘：`infra/asset_images/{assetId}/{page}-{idx}.{ext}`
- 图片 DB：`metadata_asset_image`（唯一约束 asset_id+page+image_index）
- VLM caption（opt-in 通过 `INGEST_VLM_ENABLED=true`）：
  - 模型：`Qwen/Qwen2.5-VL-72B-Instruct`（硅基，复用 EMBEDDING_API_KEY）
  - 仅对 image-heavy 页（chars<300 或 imageCount≥3）调
  - caption 写入 metadata_asset_image.caption + image_caption chunk 入向量索引
- 降级链：ODL/Java 失败 → PDFParse v2；VLM 失败 → 该图无 caption 但 chunks 不丢
- 相关 ADR：`.superpowers-memory/decisions/2026-04-21-07-pdf-pipeline-v2-odl-and-vlm.md`

## Agent 编排层

- 入口：`POST /api/agent/dispatch`（SSE）
- 鉴权：`requireAuth + enforceAcl(READ, source_id)`（unified-auth 挂载）
- 意图识别：LLM 结构化输出（快模型）+ 关键字 fallback；阈值 `AGENT_INTENT_THRESHOLD`（默认 0.6）
- 注册的 4 Agent：
  - `knowledge_qa` → 包装 `runRagPipeline`（Round 1 交付）
  - `data_admin` → 包装 `runDataAdminPipeline`
  - `structured_query` → 占位，emit `not_implemented`（等 MCP 结构化层 change）
  - `metadata_ops` → 只读 list_sources / list_assets / list_acl_rules；写操作占位
- 向后兼容：`POST /api/qa/ask` 降级为 `hint_intent=knowledge_qa` 的薄壳，内部复用 dispatchHandler
- 事件扩展：SseEvent 新增 `agent_selected`；旧客户端应忽略未知事件
- 结构化日志：每次 dispatch 打 `{user_id, intent, fallback, session_id, duration_ms}`
- 相关 ADR：`.superpowers-memory/decisions/2026-04-21-03-agent-orchestrator-contract.md`

## Permissions V2（团队 + 三层 ACL + Notebook 共享）

- **主体模型**：`subject_type ∈ {role, user, team}` + `subject_id`（通配 `*`）；老 `role` 字段回退兼容
- **效果**：`effect ∈ {allow, deny}`，deny 最高优；`expires_at` TTL（`notExpired()` 过滤）
- **资源维度**：`source_id` / `asset_id`；asset 命中同 source 的 ACL
- **团队**：`team` + `team_member` 两表；`requireAuth` 注入 `principal.team_ids / team_names`
- **Notebook 共享**：`notebook_member(notebook_id, subject_type, subject_id, role ∈ {editor, reader}, added_by)`
  - accessibility = owner ∪ user 直授 ∪ team 授
  - `GET /api/notebooks` → `{ items, shared }` 分段返回
  - `GET/POST/DELETE /api/notebooks/:id/members[/:type/:sid]`（POST upsert；owner-only 写）
- **严格种子（R-1 双轨）**：
  - 新装 DB：`ensureDefaultAclRules` 只下发 `admin` 的 READ/WRITE/ADMIN
  - 升级 DB：保留老 `subject_id='*' AND permission='READ'` 行不覆写；启动日志 WARN 一次
- **审计（F-3 · permissions-v2 scope）**：
  - `audit_log`（既有）：全业务操作流
  - `acl_rule_audit`（新建）：ACL 规则专表，before_json / after_json 结构化 diff；`GET /api/iam/acl/audit`
  - 写入失败不阻塞业务（`try/catch + console.error`）
- **Spaces/Assets 权限入口（F-2）**：行内「权限…」按钮 → `PermissionsDrawer`，复用 `POST /api/acl/rules` 并预填 source_id / asset_id
- 相关 change：`openspec/changes/permissions-v2/`
- 相关 ADR：
  - `.superpowers-memory/decisions/2026-04-21-10-unified-auth-permissions.md`（V1 基线）
  - `.superpowers-memory/decisions/2026-04-22-16-permissions-v2.md`（V2 + R-1 补丁）

## RAG Relevance Hygiene（BUG-01 · 批 E）

- **分数显示约定**：`services/relevanceFormat.ts::formatRelevanceScore` 分三档（≥0.5 `toFixed(2)` / ≥0.01 `toFixed(3)` / else `toExponential(2)`；非数字 `'—'`）。trace label 和前端 `<ConfidenceBadge>` 共享同一 bucket
- **相关性 WARN**：rerank top-1 < `RAG_RELEVANCE_WARN_THRESHOLD`（默认 0.1）→ emit `rag_step ⚠️`；不阻断流程
- **文本卫生共享 util**：`services/textHygiene.ts` 集中 3 个判别器（`looksLikeOcrFragment` / `looksLikeErrorJsonBlob` / `isBadChunk`）+ `MIN_CHUNK_CHARS=20`。`tagExtract` 和 ingest pipeline chunk gate 共用一套规则
- **ingest chunk gate**：`ingestPipeline/pipeline.ts::writeFields` 对 L3（embed 粒度）chunk 调 `isBadChunk`，bad 跳过 INSERT + 从 embed 列表剔除；L1 顶层不过滤。统计日志 `[ingest] filtered N bad chunks (asset=...)`
- **清库脚本**：
  - `scripts/cleanup-bad-chunks.sh`：bash，SQL regex 抓 `too_short` / `error_json_blob`
  - `scripts/cleanup-bad-chunks-ocr.mjs`：Node + pg，复用 `isBadChunk` 抓 OCR 碎片
  - 两者默认 dry-run；`--confirm` 才 DELETE
  - 不自动重 embed；受影响 asset 手动重跑 ingest
- **LLM 流守护**：`services/llm.ts::chatStream` 空流 → throw `'LLM stream returned no content chunks'`；reader 异常 → throw `'LLM stream interrupted'`。错误冒泡 dispatchHandler 的 catch → 前端显示明确错误
- **D-007 short-circuit（全局 KB）**：rerank 开 + top-1 < `RAG_NO_LLM_THRESHOLD`（默认 0.05）→ 跳过 LLM，emit 预设兜底 content。防 BUG-01 乱码 context 毒化
- **D-008 scope 豁免（notebook 等）**：`runRagPipeline(opts)` 的 `opts.assetIds` 非空 → **跳过** D-007 短路，仍让 LLM 走。语义：用户显式 scope 已经表达意图"用这些"，相关性判定交还用户。WARN + chatStream 空流守护不受影响
- 相关 change：`openspec/changes/rag-relevance-hygiene/`
- 相关 ADR：
  - `.superpowers-memory/decisions/2026-04-23-22-rag-relevance-hygiene-lock.md`（D-001~D-007）
  - `.superpowers-memory/decisions/2026-04-23-24-bugbatch-h-notebook-shortcircuit.md`（D-008）

## File Source Integration（外部文件服务器 · SMB 起步）

- **抽象**：`services/fileSource/types.ts::FileSourceAdapter`——`init / listFiles(cursor) / fetchFile(id) / close`。`type ∈ {smb, s3, webdav, sftp}`（本轮只实现 smb；其它 3 种工厂抛 `FileSourceTypeNotImplemented` 预留位）
- **入口**：`runScan(sourceId, signal?)` / `testConnection(sourceId)` · 同源串行由 `withSourceLock(id)` 兜底 · scan 入库身份 `SYSTEM_PRINCIPAL = { user_id:0, email:'system', roles:['system'] }`
- **存储**：新表 `metadata_file_source` + `file_source_scan_log`；`metadata_asset` 扩 `external_path / source_mtime / offline / file_source_id`；UPSERT 冲突键 `(file_source_id, external_id) WHERE file_source_id IS NOT NULL`
- **加密**：AES-256-GCM，env `MASTER_ENCRYPT_KEY`（64 hex chars）。secret 字段名追加 `_enc`；API 返回前经 `redactConfig` 替换为 `"***"`
- **调度**：进程内 `node-cron`；`bootScheduler()` 启动时排期；PATCH 后 `rescheduleOne`；DELETE 后 `unschedule`；SIGTERM → `abortAllScans`。node-cron 未装时调度关闭但手动扫仍可用
- **权限**：
  - 管理接入点 `/api/file-sources/*` 全部要求 `iam:manage`
  - 终端用户读入库 chunk 按 `permission_source_id` 走 V2 ACL
- **软删**：`metadata_asset.offline=true`，`knowledgeSearch.ts` 检索 WHERE 加 `(ma.offline IS NULL OR ma.offline = false)` 过滤；老行 offline IS NULL 不受影响
- **API**：`POST / GET / PATCH / DELETE /api/file-sources[/:id]` + `POST /:id/scan` + `GET /:id/logs` + `POST /:id/test`；全部 ADMIN 门
- **UI**：`/ingest` 批量任务 Tab 下折叠区「文件服务器」（不新建顶层 Tab）
- **依赖**：`@marsaud/smb2`（SMB2/3 NTLMv2 客户端）+ `node-cron`（调度），types 都做了 stub，tsc 无需真装
- **相关 change**：`openspec/changes/file-source-integration/`
- **相关 ADR**：`.superpowers-memory/decisions/2026-04-23-25-file-source-integration.md`
- **后续协议 change**：`file-source-s3` / `-webdav` / `-sftp`（工作流 B，消费本 change 的 `FileSourceAdapter` 接口，不改抽象）

---

## 前端代理（Vite）

- `/api/qa`        → `http://localhost:3001`
- `/api/governance`→ `http://localhost:3001`
- `/api/iam`       → `http://localhost:3001`（含 `/api/iam/teams`、`/api/iam/acl/audit`）
- `/api/file-sources` → `http://localhost:3001`
- 新增代理时同步更新此处与 `apps/web/vite.config.ts`。

---

> 新服务接入流程：
> 1. 在 `infra/docker-compose.yml` 声明；
> 2. 在 `integrations.md` 追加一节；
> 3. 写 ADR 说明凭据来源与回滚策略。

## Feature Flags

- `SPACE_PERMS_ENABLED`（ADR-25 · 2026-04-23）—— qa-service 侧
  - 默认 on（未设置 / `1` / `true` / `on` / `yes`）
  - 关闭：`0` / `false` / `off` / `no` → `resolveSpaceOf()` 始终返回空集，space-scoped ACL 规则不参评；等价 permissions-v2 老行为
  - 用途：如果发现 `space_source` 解析成为 DB 瓶颈 / ACL 错配，可快速回退

- `KG_ENABLED`（ADR-27 · 2026-04-23）—— qa-service 侧
  - 默认 on；`0/false/off/no` 关闭 → `isGraphEnabled()` 永远 false，所有 KG 写入 / 读 API 静默 no-op
  - 依赖 sidecar `kg_db`（compose 里新加的 Apache AGE 容器）；容器未起也会自动降级到关闭
  - `KG_HOST / KG_PORT / KG_DB / KG_USER / KG_PASS / KG_GRAPH` 控制连接
  - `KG_CYPHER_ENDPOINT=1` 打开 `POST /api/kg/cypher`（默认关；仅 admin + 只读）

## Apache AGE Sidecar（ADR-27）

- 位置：`infra/docker-compose.yml` 中的 `kg_db`（镜像 `apache/age:release_PG16_1.6.0`；tag 格式 `release_PG<pg>_<age>`）
- 容器端口：5433:5432（主 pg_db 占 5432）
- 数据目录：`infra/kg_data/`
- Graph 名：`knowledge`（`KG_GRAPH` 可改；⚠ 必须 ≥ 3 字符，AGE 约束）
- Schema：见 ADR-27 §D-005；节点 Asset / Source / Space / Tag / Question；边 CONTAINS / SCOPES / HAS_TAG / CITED / CO_CITED

## Web Search 联网检索（ADR-35 · 2026-04-26）

- 状态：Accepted（默认 provider=none，私有内网零外发）
- 用途：QA composer 🌐 toggle 触发，结果作 [w1..wN] 拼进 LLM context
- Provider：Tavily（默认推荐 · 1000/月免费 · agent-friendly）/ Bing v7（备选）/ none
- 关键 env：`WEB_SEARCH_PROVIDER` + `TAVILY_API_KEY` 或 `BING_API_KEY` + `WEB_SEARCH_TIMEOUT_MS=5000` + `WEB_SEARCH_DEFAULT_TOP_K=5`
- 入口：`apps/qa-service/src/services/webSearch.ts`，`webSearch(query, opts) → WebSearchHit[]`，永不抛
- 集成位：`ragPipeline.runRagPipeline` 在 `generateAnswer` 之前，软超时 5s
- 降级：未配置 / 超时 / 限流时返 [] + emit `rag_step ⚠️`，主链路不阻塞
- SSE 新事件 `web_step`（旧客户端忽略）

## QA 多模态附件（ADR-35 · 2026-04-26）

- 状态：Accepted
- 用途：QA composer 🖼 file picker，图片 base64 经 dispatch 喂 Qwen2.5-VL-72B
- 复用：`INGEST_VLM_MODEL`（默认 `Qwen/Qwen2.5-VL-72B-Instruct`），与 PDF v2 caption 同模型
- 上限：前端 6MB / 后端 8MB base64
- 集成位：`generateAnswer.extras.image` → 用户消息走 `ContentBlock[]` + 模型切换到 VL
- 凭据：复用 `EMBEDDING_API_KEY`（硅基），零新 secret

## Ingest L0/L1 Abstract（ADR-32 · 2026-04-26 · **Accepted**）

- 状态：Accepted。验收时 GM-LIFTGATE32 召回反向提升 +2.7pp（recall@1 0.946 → 0.973，recall@5 0.973 → 1.000）
- generator v2（2026-04-26 升级）：Qwen2.5-72B + `response_format: json_object` + 2 条 few-shot + temperature=0.2
  - v1 用 7B + 纯 prompt 实测 not-json 8/8 全失败；v2 修复后 10/10 全过
- 上游：ADR-31 验证可行后，把 L0 摘要思想从 OpenViking sidecar 搬进 ingest 自实现
- 新表：`chunk_abstract(chunk_id UNIQUE, asset_id, l0_text, l0_embedding vector(4096), l1_text, generator_version, generated_at)`；IVFFLAT 索引
- 视图：`asset_abstract`（聚合 chunk_abstract 出 asset 级 l0_summary）
- 新模块：
  - `services/ingestPipeline/abstract.ts`：`generateAbstractsForAsset` / `generateAbstractsForChunks`
  - `services/ingestPipeline/abstractBackfill.ts`：lazy 入队
  - `services/l0Filter.ts`：`coarseFilterByL0` / `chunksMissingL0`
- 集成位：
  - ingest：`runPipeline` 的 embed phase 之后，phase `'abstract'`，progress 数值 98
  - RAG：`retrieveInitial` 之前可选粗筛；命中时注入 `assetIds`
  - Worker：`ingestWorker.runOne` 路由 `kind='abstract'` 到 `generateAbstractsForChunks`
- Feature Flag（三档）：
  - `L0_GENERATE_ENABLED=true`（默认 on）→ ingest 是否生成
  - `L0_FILTER_ENABLED=false`（默认 off，eval 通过才打开）→ RAG 是否粗筛
  - `L0_LAZY_BACKFILL_ENABLED=false`（默认 off）→ rerank 后是否后台 enqueue
- 调参：
  - `L0_GENERATE_CONCURRENCY=4` / `L0_GENERATE_MIN_CHARS=60`
  - `L0_FILTER_TOP_ASSETS=50`
- LLM：复用 `getLlmFastModel()`（Qwen2.5-7B），不浪费 72B
- 回填：
  - lazy：rerank 后 fire-and-forget 入队 `kind='abstract'` 的 ingest_job
  - active：`scripts/backfill-l0.mjs`（dry-run / commit / resume / rate-per-min）
- 退出条件：ingest 慢 30%+ 或召回退化 > 3pp 或 token 节省 < 25% 或表 size > 30% metadata_field → 关三 flag
- 相关 ADR：`.superpowers-memory/decisions/2026-04-26-32-ingest-l0-abstract.md`
- 相关 change：`openspec/changes/ingest-l0-abstract/`
- 验收手册：`docs/verification/ingest-l0-abstract.md`

## OpenViking Sidecar（ADR-31 候选 · 2026-04-26 · **实验**）

- 状态：候选实验，**默认不启动**，未进生产
- 位置：`infra/docker-compose.yml` 中的 `openviking`（profile `viking`，build context = `apps/openviking-service/`）
- 容器端口：1933:1933
- 数据目录：`infra/openviking_data/`
- 用途：Agent 跨会话长期记忆（filesystem 范式 + L0/L1/L2 分级）；当前**只用 memory 一面**，不同步 BookStack
- 凭据：复用 `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL`（硅基 Qwen），无新增 secret
- Feature Flag：`VIKING_ENABLED=0` 默认 off → qa-service 端 `services/viking/` 全 no-op；容器没起也自动降级
- 路径约定（client 强制）：`viking://user/<principal.id>/sessions/<sid>/...`
- 相关 ADR：`decisions/2026-04-26-31-openviking-sidecar-experiment.md`
- 验收手册：`docs/verification/openviking-sidecar.md`
- 启停：
  - 启用：`VIKING_ENABLED=1 docker compose -f infra/docker-compose.yml --profile viking up -d openviking`
  - 关闭：`docker compose -f infra/docker-compose.yml stop openviking`
  - 抹数据：`rm -rf infra/openviking_data`
- 退出条件见 ADR-31，任一红线触发就关 flag 删容器
