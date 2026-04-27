# Design: graph-insights

> Lock 阶段设计；与 `proposal.md` 配套。Explore 全文在 `docs/superpowers/specs/graph-insights/design.md`，此处仅锁定技术抉择。

## 关键决策

### D-001 Louvain 跑在 Node.js 侧
- **决策**：用 `graphology@0.25.x` + `graphology-communities-louvain`，从 AGE 拉子图到内存跑。
- **理由**：AGE 不带 Louvain；引 `pg_graphblas` / PL/Python 扩展与现有 sidecar 部署（ADR-27）冲突。Node 侧 JS 实现在 |E|≤10_000 尺度内 benchmark 通常 < 500ms。
- **备选被拒**：Postgres UDF（增运维面）、Rust NAPI（工程过重）。

### D-002 `CO_CITED` 作为 Louvain 唯一输入边
- **决策**：`HAS_TAG` 不进 Louvain，只在"Louvain 降级 / bridge 回退识别"时用。
- **理由**：`CO_CITED` 是行为派生（同题共现），语义干净；`HAS_TAG` 受 ontology 手工增删污染，不同来源的 tag 质量差异大。
- **配置**：`GRAPH_INSIGHTS_LOUVAIN_RESOLUTION=1.0`（env 可覆盖）；`GRAPH_INSIGHTS_LOUVAIN_EDGE_TYPES=CO_CITED`（硬编码列表，v1 不暴露）。

### D-003 惊奇度权重自定，不抄 llm_wiki
```
surprise_score = 3.0 * is_cross_community(e)
               + 1.5 * is_cross_type(e)          // a.type ≠ b.type
               + 1.0 * log(1 + coalesce(e.weight, 1))
```
- `is_cross_community`：仅在 Louvain 启用时有效；降级时退化为"两端点无共同 tag"。
- `coalesce(e.weight, 1)`：AGE 写入侧 `CO_CITED {weight}` 字段（`knowledgeGraph.ts:L146-158`）；对老数据缺失处理。
- 权重常量通过 env `GRAPH_INSIGHTS_WEIGHT_*` 可覆盖，**不写入 payload**（避免客户端做二次评分）。

### D-004 双保险缓存失效
1. **TTL**：`now() - computed_at > ttl_sec`（默认 1800s，env `GRAPH_INSIGHTS_TTL_SEC`）
2. **Graph signature**：拉子图前先算 `{asset_count, co_cited_count, max_indexed_at}`，与 cache 的 `graph_signature` 串对比，不一致重算
3. **手动刷新按钮**：`POST /api/insights/refresh`（Admin only）无条件重算

### D-005 并发控制用 PG advisory lock
```sql
SELECT pg_try_advisory_lock(hashtext('graph_insights:' || $1))  -- $1 = space_id
```
- 拿到锁：重算 + 写 cache + 释放
- 未拿到锁：直接读旧 cache（即使 stale）+ 记 WARN `graph_insights_cache_hit{reason:'advisory_lock_held'}`
- **不等锁**（`pg_try_*` 非阻塞），用户不会看到长时间转圈

### D-006 Dismissed 存二级表而非塞进 payload
- **表**：`metadata_graph_insight_dismissed (user_email, space_id, insight_key, dismissed_at)`
- `insight_key` 计算方式（稳定哈希，跨重算保持同一条洞察 identity）：
  - `isolated`: `sha256('iso:' + asset_id)`
  - `bridges`: `sha256('bri:' + asset_id)`
  - `surprises`: `sha256('sur:' + min(asset_a,asset_b) + ':' + max(...))`
  - `sparse`: `sha256('spa:' + sorted(community_asset_ids).join(','))`
- 路由层按 `user_email` 过滤 payload（server-side），前端不需要自行去重
- 缺点：sparse 的 `insight_key` 在社区成员变化时会变——可接受（用户 dismiss 的是"当时的那个稀疏社区"，成员变了就是新的 insight）

### D-007 降级路径
| 条件 | 行为 | payload 标记 |
|------|------|-------------|
| AGE 不可达 | `503 {code:'KG_UNAVAILABLE'}` | — |
| `|E| > GRAPH_INSIGHTS_MAX_EDGES` (默认 10_000) | 跳过 Louvain；bridges 用 `HAS_TAG` 回退；surprises 返回空；sparse 返回空 | `degraded: true, reason: 'graph_too_large'` |
| `graphology-communities-louvain` 抛异常 | 同上，额外记 `graph_insights_louvain_failed` | `degraded: true, reason: 'louvain_exception'` |
| Space 无资产 | 200 + 空数组 | `degraded: false`（非降级，是正常空） |

## 数据结构

### `metadata_graph_insight_cache`
```sql
CREATE TABLE metadata_graph_insight_cache (
  space_id            INT         NOT NULL,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ttl_sec             INT         NOT NULL DEFAULT 1800,
  graph_signature     TEXT        NOT NULL,
  payload             JSONB       NOT NULL,
  PRIMARY KEY (space_id),
  FOREIGN KEY (space_id) REFERENCES space(id) ON DELETE CASCADE
);
CREATE INDEX idx_mgic_computed_at ON metadata_graph_insight_cache(computed_at);
```

### `metadata_graph_insight_dismissed`
```sql
CREATE TABLE metadata_graph_insight_dismissed (
  user_email   VARCHAR(255) NOT NULL,
  space_id     INT          NOT NULL,
  insight_key  CHAR(64)     NOT NULL,       -- sha256 hex
  dismissed_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_email, space_id, insight_key),
  FOREIGN KEY (space_id) REFERENCES space(id) ON DELETE CASCADE
);
CREATE INDEX idx_mgid_user_space ON metadata_graph_insight_dismissed(user_email, space_id);
```

## Payload JSON Schema（截断示例）

```jsonc
{
  "space_id": 12,
  "generated_at": "2026-04-24T13:10:00Z",
  "computed_at": "2026-04-24T13:09:58Z",     // 缓存命中时此值 < now - ttl_sec 的情况不应出现
  "degraded": false,
  "stats": { "asset_count": 487, "edge_count": 1832, "community_count": 11 },
  "isolated": [
    { "key":"<sha256>", "asset_id":1203, "name":"a.pdf", "type":"pdf",
      "degree":0, "created_at":"2026-04-17T..." }
  ],
  "bridges": [
    { "key":"<sha256>", "asset_id":882, "name":"架构总览", "type":"md",
      "bridge_communities_count":4, "neighbor_sample":[103,271,559,612] }
  ],
  "surprises": [
    { "key":"<sha256>", "a":{"id":103,"type":"pdf"}, "b":{"id":612,"type":"md"},
      "edge_weight":5, "cross_community":true, "cross_type":true,
      "surprise_score":6.79 }
  ],
  "sparse": [
    { "key":"<sha256>", "community_id":7, "size":5, "cohesion":0.12,
      "core_assets":[{"id":45,"name":"x","degree":3}, ...] }
  ]
}
```

## API

| Method | Path | Auth | 用途 |
|---|---|---|---|
| GET | `/api/insights?spaceId=N` | requireAuth + enforceAcl(Viewer) | 读缓存或按需计算 |
| POST | `/api/insights/refresh` body `{spaceId}` | requireAuth + role=Admin | 强制重算 |
| POST | `/api/insights/dismiss` body `{spaceId, insight_key}` | requireAuth + enforceAcl(Viewer) | 标记已看 |
| DELETE | `/api/insights/dismiss` body `{spaceId, insight_key}` | 同上 | 取消 |

Deep Research 不增路由，前端直接调 `POST /api/agent/dispatch`（既有契约）。

## 环境变量清单

```
GRAPH_INSIGHTS_ENABLED=true
GRAPH_INSIGHTS_TTL_SEC=1800
GRAPH_INSIGHTS_LOUVAIN_RESOLUTION=1.0
GRAPH_INSIGHTS_MAX_EDGES=10000
GRAPH_INSIGHTS_TOP_SURPRISES=10
GRAPH_INSIGHTS_WEIGHT_CROSS_COMMUNITY=3.0
GRAPH_INSIGHTS_WEIGHT_CROSS_TYPE=1.5
GRAPH_INSIGHTS_WEIGHT_EDGE_LOG=1.0
GRAPH_INSIGHTS_TOPIC_MODEL=         # 空则沿用 ragPipeline 同模型
GRAPH_INSIGHTS_ISOLATED_MIN_AGE_DAYS=7
GRAPH_INSIGHTS_SPARSE_COHESION_THRESHOLD=0.15
GRAPH_INSIGHTS_SPARSE_MIN_SIZE=3
```

## 风险与缓解（Lock 版，精简自 Explore）

| 风险 | 缓解 |
|------|------|
| R1 Louvain 延迟不可控 | D-007 降级；`|E|>10_000` 直接跳过 Louvain；验收门 p95≤2000ms |
| R3 权重数值无真实数据支撑 | 全部 env 可覆盖；eval 后再调 |
| R6 并发重算 | D-005 advisory lock |
| R8 ACL 横向越权 | 路由层 `enforceAcl` + payload 内 assetId 前端二次查询也走 ACL；测试覆盖见 specs |

## 不变更

- `services/knowledgeGraph.ts`（写入侧；graph-insights 只读）
- `services/ragPipeline.ts`（Deep Research 直接复用，不改签名）
- `services/hybridSearch.ts`
- `agent/dispatchHandler.ts`（不新增 intent）
- `components/DetailGraph.tsx`（未来反链是 v2）
- AGE schema（ADR-27 冻结）
