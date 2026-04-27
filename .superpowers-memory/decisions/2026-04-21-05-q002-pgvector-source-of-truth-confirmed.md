# ADR 2026-04-21-05 · 关闭 Q-002：确认 pgvector = 知识问答 source-of-truth，MySQL 只承担治理表

## Context

Open Question **Q-002**：pgvector 与 BookStack MySQL 的冗余元数据对齐策略？

Round 1 knowledge-qa change（D-001）已定 RAG 检索源 = pgvector / metadata-catalog；
剩余疑问是：两个 DB 的角色分界、source-of-truth 在哪一侧。

## Decision

**数据分层明确：**

| Store | 用途 | 谁是 source-of-truth |
|---|---|---|
| **pgvector `metadata_*`** | 向量检索、资产目录、字段级 mask 规则 | 所有"检索/召回"语义 |
| **BookStack MySQL** | BookStack 自身（页面、用户、书架） | BookStack 业务数据 |
| **BookStack MySQL `knowledge_user_roles`** | qa-service 治理表 | 用户角色（Principal.roles） |
| **BookStack MySQL `knowledge_shelf_visibility`** | 空间可见性（UI-only） | Governance UI 展示用 |

**同步方向**：BookStack → pgvector 单向（`scripts/sync-bookstack.ts`）。
pgvector 不反写 BookStack。

**冗余策略**：
- `metadata_asset.name / path` 可以比 BookStack 页面 title 略滞后，通过
  scheduled 同步收敛；
- 删除策略：BookStack 删页面时，pgvector 的 `metadata_asset` 不自动清理，
  由 `sync-bookstack` 脚本批量对账（比对 BookStack 页面列表）软删除。

**失败回放**：
- `sync-bookstack.ts` 幂等；可重复运行
- `knowledge_sync_meta` 表记录最后同步游标（updated_at）
- 失败不阻塞 RAG（pgvector 仍可服务已有数据）

## Consequences

**正面**
- Q-002 收敛；下游设计不再需要"问谁权威"
- 删除 BookStack fallback 的路径清晰（knowledge-qa 已下线，仅 vectorSearch.ts 保留备用）

**负面 / 取舍**
- 新写入页面要等同步脚本回灌才能被 RAG 召回（首次延迟；后续周期同步）
- BookStack 单机故障时 RAG 仍可用，但新写入数据会堆积

## Links

- knowledge-qa ADR: `.superpowers-memory/decisions/2026-04-21-01-rag-source-of-truth.md`
- metadata-catalog-pgvector: `openspec/changes/metadata-catalog-pgvector/`
- sync 脚本: `apps/qa-service/scripts/sync-bookstack.ts`
- 关闭的问题: `.superpowers-memory/open-questions.md#Q-002`
