# MEMORY — knowledge-platform · 快速索引

> 给下一次会话用：先看这个索引，按需跳到具体文件。维护规则见 `README.md`。
> 所有 ADR 按日期+序号命名、只追加不覆盖；有冲突新开 ADR 引用旧编号。

## 日期维度 · 最近进度

- [2026-04-25 snapshot · knowledge-graph-view](PROGRESS-SNAPSHOT-2026-04-25-knowledge-graph-view.md) — `/knowledge-graph` 路由；sigma.js + ForceAtlas2 + Asset.type 着色；ADR-42
- [2026-04-25 snapshot · graph-insights](PROGRESS-SNAPSHOT-2026-04-25-graph-insights.md) — graph-insights 工作流 B 一贴到底：Explore→Lock→Execute→Verify→Archive；llm_wiki 概念级借鉴；ADR-41
- [2026-04-23 snapshot](PROGRESS-SNAPSHOT-2026-04-23.md) — 上午 permissions-v2 lock/exec/归档；下午 24 条 bug 分 5 批清完，含 BUG-01 核心检索走完整工作流 B
- [2026-04-22 snapshot](PROGRESS-SNAPSHOT-2026-04-22.md) — permissions-v2 选型 + 代码落地（§八）；V2 backlog 列全
- [2026-04-21 snapshot](PROGRESS-SNAPSHOT-2026-04-21.md) — 初始规划：RAG + unified-auth + governance + pipeline + ingest UI 等 15 条 ADR 底座

## 主题维度 · 决策速查（按场景找 ADR）

### 权限与身份（最活跃）
- [Knowledge Graph · Apache AGE](decisions/2026-04-23-27-knowledge-graph-age.md) — **ADR-27（2026-04-23）**：sidecar PG 跑 AGE；Asset/Source/Space/Tag/Question 节点 + CITED/CO_CITED 边；ingest + spaces + RAG 三处 fire-and-forget 写入；DetailGraph 改读真实邻域 + 无数据回退 mock；flag `KG_ENABLED`
- [Space Permissions · Lock + Execute](decisions/2026-04-23-26-space-permissions-lock.md) — **ADR-26（2026-04-23）**：Space 一级实体 + member 四角色（Owner/Admin/Editor/Viewer）投影到 `metadata_acl_rule.space_id`；`RulesTab` 加作用域列 + 投影规则只读；feature flag `SPACE_PERMS_ENABLED`
- [Permissions V1 基线 · unified-auth](decisions/2026-04-21-10-unified-auth-permissions.md) — Principal+permissions / ROLE_TO_PERMS / enforceAcl / /api/auth/me
- [Permissions V1 · IAM UI](decisions/2026-04-21-12-permissions-admin-ui.md) — /iam 路由 + Rules/Matrix/Users Tab + Simulate
- [User Admin CRUD · G10](decisions/2026-04-21-15-user-admin.md) — users 表 + 改角色/删用户/重置密码 + ChangePasswordModal
- [Permissions V2 · 选型](decisions/2026-04-22-16-permissions-v2.md) — 三主体（role/user/team）+ deny 最高优 + TTL + Notebook 共享 + 严格种子
- [Permissions V2 · Lock](decisions/2026-04-23-17-permissions-v2-lock.md) — D-001 R-1 双轨 · D-002 `acl_rule_audit` 新表 · D-003 Drawer 无新后端 · D-004 F-1 冒烟放 Execute 末
- [RBAC 网关 · HS256 默认](decisions/2026-04-21-02-unified-auth-gateway.md) + [Q-001 OIDC 推后](decisions/2026-04-21-04-q001-rbac-token-closes-hs256-default.md)
- [Real Login](decisions/2026-04-21-14-real-login.md) — G9 登录链路闭环

### RAG / 检索质量
- [RAG source of truth](decisions/2026-04-21-01-rag-source-of-truth.md) — 检索与问答真相源
- [Q-002 pgvector 确认](decisions/2026-04-21-05-q002-pgvector-source-of-truth-confirmed.md) — pgvector=检索真相，MySQL 只做治理
- [Agent Orchestrator 契约](decisions/2026-04-21-03-agent-orchestrator-contract.md) — /api/agent/dispatch 四 intent
- [Knowledge Governance](decisions/2026-04-21-09-knowledge-governance.md) — 治理模块
- [RAG Relevance Hygiene](decisions/2026-04-23-22-rag-relevance-hygiene-lock.md) — **BUG-01 根治**：分数分桶显示 + top-1 阈值 WARN + textHygiene 共享 + ingest chunk gate + chatStream 空流守护 + **D-007 short-circuit**（低相关跳 LLM）
- [Notebook short-circuit 豁免](decisions/2026-04-23-24-bugbatch-h-notebook-shortcircuit.md) — **D-008**：`opts.assetIds` 非空 = 用户显式 scope（notebook 等），跳过 D-007 短路保留 LLM 合成能力；WARN + 空流守护不动

### Ingest / 文档 pipeline
- [PDF Pipeline v2 · ODL + VLM](decisions/2026-04-21-07-pdf-pipeline-v2-odl-and-vlm.md)
- [Ingest 统一](decisions/2026-04-21-08-ingest-pipeline-unify.md)
- [Ingest UI Rich · G11](decisions/2026-04-21-13-ingest-ui-rich.md)
- [File Source Integration · SMB 起步](decisions/2026-04-23-25-file-source-integration.md)
- [xlsx Ingest 根治](decisions/2026-04-24-28-xlsx-ingest-fix.md) — **ADR-28（2026-04-24）**：D-009 `decodeUploadedFilename` 修 multipart UTF-8-as-latin1 乱码 · D-010 xlsx 走 AST sheet/row/cell（第二轮 D-011 改成 ~500 字聚合块，规避 textHygiene `MIN_CHUNK_CHARS=20` 过滤）· 0 chunks 显式抛错不再静默"完成"
- [资产删除能力](decisions/2026-04-24-30-asset-delete.md) — **ADR-30（2026-04-24）**：后端 DELETE 端点加 `requireAuth + enforceAcl` + 磁盘图片清理 + audit_log；前端 Detail 顶栏 + 列表卡片两处 🗑 按钮；FK CASCADE 带走 chunks/images
- [BookStack 附件索引](decisions/2026-04-24-31-bookstack-attachment-ingest.md) — **ADR-31（2026-04-24）**：BookStack sync 以前只读 page HTML body，附件文件从未被下载（xlsx/pdf 因此无切片）；加 `listPageAttachments` + `getAttachmentContent`；`indexBookstackPage` 三段式（老 MySQL · pg 页面正文 · pg 附件）；幂等按 `external_path='bookstack:attachment:{id}'`；加 `POST /api/asset-directory/reindex-page` 单页重跑入口
- [提取诊断可见性](decisions/2026-04-24-32-ingest-diagnostics.md) — **ADR-32（2026-04-24）**：`metadata_asset` 扩 3 列（`extractor_id` / `ingest_warnings` / `ingest_chunks_by_kind`），`runPipeline` 写入快照；资产详情页 Banner 加"提取器 / 切片分类 / 警告"一行，用户自助诊断"xlsx 是否真走了 xlsxExtractor" — `FileSourceAdapter` 抽象（listFiles/fetchFile + mtime cursor）· `metadata_file_source` 表 · AES-256-GCM 加密 · SYSTEM_PRINCIPAL scan · `offline=true` 软删 · node-cron 调度 · `/ingest` 批量任务下折叠区；S3/WebDAV/SFTP 预留接口位

### MCP / 资产目录
- [MCP Service](decisions/2026-04-21-11-assets-and-mcp-ui.md) — /mcp + Assets UI
- [Q-003 审批队列暂缓](decisions/2026-04-21-06-q003-approval-queue-deferred.md)

### Graph Insights（2026-04-25 · 主动发现）
- [Graph Insights · 图谱洞察 + Deep Research](decisions/2026-04-25-41-graph-insights.md) — **ADR-41（2026-04-25）**：工作流 B 一贴到底；新路由 `/insights`；四类洞察（孤立/桥接/惊奇/稀疏）按需计算 + TTL/signature 双失效 + advisory lock 防并发；Louvain 在 Node 侧（graphology），仅消费 CO_CITED；Deep Research 复用 `runRagPipeline.opts.assetIds/spaceId`，零 Agent 改动；GPL-3 合规——只借 llm_wiki 概念，不引源代码；新增 `metadata_graph_insight_cache` + `metadata_graph_insight_dismissed` 两张表
- [Knowledge Graph View · 全 Space 力导向图](decisions/2026-04-25-42-knowledge-graph-view.md) — **ADR-42（2026-04-25）**：工作流 B 一贴到底；新路由 `/knowledge-graph`；sigma.js + graphology + ForceAtlas2 三依赖通过 React.lazy 切独立 chunk（主 bundle 增量 0KB）；新端点 `GET /api/kg/graph?spaceId=N` 返渲染就绪 GraphPayload；按 Asset.type 8 类文件型着色；hover 邻居高亮 + 双击跳 `/assets/:id`；老 Space 无 AGE 数据时 `empty:true + banner` 引导，**不**做 lazy backfill；与 graph-insights 通过 stats bar 链接互通

### Ontology（2026-04-24 三件套 + follow-up）
- [OAG 检索](decisions/2026-04-24-33-ontology-oag-retrieval.md) — **ADR-33**：`expandOntologyContext` 插入 rerank→gradeDocs 之间；复用 AGE + `evaluateAcl`；空结果时 prompt 与旧版字节一致
- [声明式 Skills](decisions/2026-04-24-34-ontology-declarative-skills.md) — **ADR-34**：`.skill.yaml` + 可选 `.hook.ts`；`backend.kind=http|hook|compose`；legacy 两工具迁移；`mcp-schema.json` 改为 build 产物
- [Action 框架](decisions/2026-04-24-35-ontology-action-framework.md) — **ADR-35**：state machine + webhook + 5 内置 Action + Governance UI "操作与审批" tab；`AclResource` 追加 `action_name?` / `action_run_id?`
- [Eval golden set 对齐](decisions/2026-04-24-36-eval-golden-set-realign.md) — **ADR-36**：SERIAL 不回收；僵尸资产（chunks=0）导致 eval 0 命中；`scripts/find-zombie-assets.mjs`
- [Governance/Actions UI 接通](decisions/2026-04-24-38-governance-actions-list-wire.md) — **ADR-38**：`GET /api/actions/runs` 列表端点 + 前端并发拉 pending/history + error state 可见可重试；解决 ADR-35 交付的 MVP UI shell gap

### 工程纪律
- [qa-service dev runner = `--experimental-strip-types`](decisions/2026-04-24-37-ts-strip-types-discipline.md) — **ADR-37**：禁用 parameter property / enum / namespace / 装饰器；新代码合并前必须冷启 30s 验证；含 reviewer 用 egrep 检查命令

### Bug 批清 · 2026-04-23
- [批 A · UI 小改 8 条](decisions/2026-04-23-18-bugbatch-a.md) — Notebooks 标题/NaN时间 · 面包屑 · navItems 补 agent · 文案
- [批 B · Tab + 表单 6 条](decisions/2026-04-23-19-bugbatch-b.md) — kc-tab active+hover 紫字紫底修 · "去 disabled + onClick setErr" 统一模式
- [批 C · Mock 文案下架 2 条](decisions/2026-04-23-20-bugbatch-c.md) — 面向用户字符串 5 类禁词原则
- [批 D+F · 数据/ETL + 功能未做 7 条](decisions/2026-04-23-21-bugbatch-d-and-f.md) — sanitizePreview / OCR 碎片过滤 / staleTime / 同名去重 / 侧栏搜索框
- [批 E · BUG-01 核心检索](decisions/2026-04-23-22-rag-relevance-hygiene-lock.md)（同上 RAG 段）
- [批 G · 浏览器回归清单 6 条](decisions/2026-04-23-23-bugbatch-g.md) — notranslate 防御 · 默认凭据下架 · /iam PRD 编号清 · BatchTab 未来承诺清 · Top5 同名 normalize · /mcp stats 改 useQuery
- [批 H · Notebook short-circuit 过拟合修复](decisions/2026-04-23-24-bugbatch-h-notebook-shortcircuit.md) — D-008：`opts.assetIds` 非空 = 用户显式 scope，跳过 NO_LLM_THRESHOLD 短路，交还给 LLM；WARN + 空流守护不动

## 跨服务真相源
- [integrations.md](integrations.md) — BookStack / MySQL / pgvector / Permissions V2 / RAG Relevance Hygiene / Vite 代理

## 业务名词
- [glossary.md](glossary.md) — Space/QA Service/MCP Service/Governance/Metadata Catalog/OpenSpec Change

## 未解问题
- [open-questions.md](open-questions.md) — Q-001~Q-003 / OQ-INGEST-1 / llm_wiki 图谱洞察接入 / llm_wiki 知识图谱视图接入 已关闭；当前未决：OQ-ONT-1~5 / OQ-AGENT-1 / OQ-SQLSEC-1 / **OQ-GI-FUTURE-1/2/3**（graph-insights 衍生）/ **OQ-KGV-FUTURE-1**（kg view 衍生：AGE 老 Space backfill）

## 工作流心得（复盘要点）
- **工作流 B** 的 Lock 阶段贴着真实代码写契约，每次都能抓到 5 处左右 spec-vs-code drift（表名 / 字段名 / HTTP 动词等）
- **工作流 C** 小改按根因分桶 > 按严重度分桶，同根因共享方案（例：批 B 3 个表单 → 同一"onClick setErr"方案）
- **Sandbox 限制**：可跑 `tsc --noEmit`，不可跑 `pnpm test`（vitest 缺 linux rollup binary + 无 npm registry）；所有 unit test 交给用户本机，累计新增 ~80 case 无新 fail
- **工作流 C 默认**：一批 bug = 一份 ADR；不产 OpenSpec 契约。Lock 不值得上的小改不强求

## 维护规则速查
- `decisions/` 永不覆盖；有冲突新开 ADR 引用旧编号
- `open-questions.md` 关闭时迁到 ADR，从本表"已关闭"区对应
- 写用户可见字符串禁 5 类：内部决策编号 / 未来时间承诺 / 文件路径 / 撒谎式夸大 / `mock` 作为独立词（批 C ADR）
- 每次会话第一句写明工作流名称（A/B/C/D）—— CLAUDE.md 启动规则
