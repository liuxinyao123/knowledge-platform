# Spec: graph-insights

## GET /api/insights

**Scenario: 首次请求，缓存未命中，正常计算**
- Given space_id=12，该 Space 有 120 个资产，约 400 条 CO_CITED 边
- And `metadata_graph_insight_cache` 中无 space_id=12 的行
- When 调 `GET /api/insights?spaceId=12`（带有效 JWT，调用者对该 Space 有 Viewer 权限）
- Then 响应 200 OK
- And 响应体 `degraded=false`，含 `stats`, `isolated`, `bridges`, `surprises`, `sparse` 四个数组
- And `computed_at` ≈ now（误差 ≤ 2s）
- And `metadata_graph_insight_cache` 新增一行 `space_id=12`

**Scenario: 缓存命中（TTL 内 + signature 一致）**
- Given cache 中存在 space_id=12 的行，`computed_at = now - 5min`，`ttl_sec = 1800`
- And 当前 `{asset_count, co_cited_count, max_indexed_at}` 签名与 cache 的 `graph_signature` 一致
- When 调 `GET /api/insights?spaceId=12`
- Then 响应 200 且直接返回 cache.payload
- And 不调用 graphology、不查 AGE 的全图拉取
- And 日志出现 `graph_insights_cache_hit{space_id:12, reason:'valid'}`

**Scenario: 缓存过期（TTL 超）→ 重算**
- Given cache 的 `computed_at = now - 2h`, `ttl_sec = 1800`
- When 调 `GET /api/insights?spaceId=12`
- Then 重算并 UPSERT cache
- And 新 cache 的 `computed_at` ≈ now

**Scenario: signature 不一致 → 重算**
- Given cache 的 `graph_signature = 'a=100,e=300,m=2026-04-20T...'`
- And 当前子图 asset_count=120（资产数已变）
- When 调用 API
- Then 触发重算，忽略 TTL

**Scenario: 匿名请求被拒**
- Given 无 Authorization 头
- When 调 `GET /api/insights?spaceId=12`
- Then 响应 401 Unauthorized

**Scenario: 越权访问**
- Given 调用者对 space_id=12 无 Viewer 权限
- When 调 API
- Then 响应 403 Forbidden
- And 不查 cache、不触发计算

**Scenario: spaceId 缺失**
- When 调 `GET /api/insights`（无 spaceId）
- Then 响应 400 `{code:'SPACE_ID_REQUIRED'}`
- And **不**回退到"全局洞察"（v1 out of scope）

**Scenario: payload 过滤 dismissed**
- Given user_email='u@x' 已 dismiss `insight_key='abc123...'`（属于 space_id=12 的某条 bridges）
- And cache payload 的 bridges 数组含该 insight_key
- When u@x 调 `GET /api/insights?spaceId=12`
- Then 响应 payload 的 bridges 数组**不**含该 insight_key
- And 同一时刻另一用户 v@x 调 API，v@x 的 payload 仍含该 insight_key

## 四类洞察算法

**Scenario: isolated — 度 0 且足够老**
- Given Asset A：`degree(CO_CITED ∪ HAS_TAG) = 0`，`created_at = now - 10d`
- When 计算 isolated
- Then A 出现在 isolated 数组
- And 每条 `{key, asset_id, name, type, degree, created_at}` 齐全

**Scenario: isolated — 度 0 但是新资产**
- Given Asset B：degree = 0，`created_at = now - 3d`（< `GRAPH_INSIGHTS_ISOLATED_MIN_AGE_DAYS=7`）
- When 计算 isolated
- Then B **不**出现在 isolated 数组

**Scenario: isolated — 度 = 1**
- Given Asset C：degree = 1（刚好阈值边界）
- When 计算
- Then C 出现在 isolated 数组（定义为 `≤ 1`）

**Scenario: bridges — Louvain 启用**
- Given Louvain 启用，C 的 CO_CITED 邻居分布在 4 个不同社区
- When 计算
- Then C 出现在 bridges，`bridge_communities_count=4`

**Scenario: bridges — Louvain 降级，HAS_TAG 回退**
- Given `|E|=12000 > GRAPH_INSIGHTS_MAX_EDGES=10000`
- And Asset D 有 HAS_TAG 连接到 3 个不同的 tag
- When 计算
- Then payload `degraded=true`, `reason='graph_too_large'`
- And D 出现在 bridges（HAS_TAG 回退口径）
- And surprises 和 sparse 均为 `[]`

**Scenario: surprises — 跨社区 + 跨类型的边**
- Given CO_CITED edge (a=103 pdf, b=612 md, weight=5)
- And Louvain 把 a 放社区 2，b 放社区 7
- When 计算 surprises
- Then 该边出现，`cross_community=true, cross_type=true`
- And `surprise_score ≈ 3.0·1 + 1.5·1 + 1.0·log(1+5) ≈ 6.79`

**Scenario: surprises — 同社区边不出现**
- Given 一条 CO_CITED 边两端点同属社区 2
- When 计算
- Then 该边**不**出现在 surprises

**Scenario: surprises — top-N 截断**
- Given `GRAPH_INSIGHTS_TOP_SURPRISES=10`，共 50 条跨社区边
- When 计算
- Then surprises 数组长度 = 10，按 surprise_score 降序

**Scenario: sparse — 内聚度低**
- Given 社区 7：5 个成员，内部 CO_CITED 边数 = 1；C(5,2)=10 → cohesion=0.1 < 0.15
- When 计算
- Then 社区 7 出现在 sparse，`size=5, cohesion=0.1`
- And `core_assets` 为度最高的 3 个成员

**Scenario: sparse — 社区过小**
- Given 社区 9：仅 2 成员（< `GRAPH_INSIGHTS_SPARSE_MIN_SIZE=3`）
- When 计算
- Then 社区 9 **不**进 sparse

## POST /api/insights/refresh

**Scenario: Admin 强制刷新**
- Given 调用者 role=Admin，cache 存在且 TTL 内
- When `POST /api/insights/refresh {spaceId:12}`
- Then 响应 200 + 新 payload
- And cache 被 UPSERT

**Scenario: 非 Admin 被拒**
- Given 调用者 role=Editor
- When `POST /api/insights/refresh {spaceId:12}`
- Then 响应 403

**Scenario: 并发刷新 — advisory lock 生效**
- Given Admin A 与 Admin B 同时 `POST /api/insights/refresh {spaceId:12}`
- When 两请求几乎同时到
- Then 一个拿到 `pg_try_advisory_lock` → 重算；另一个未拿到 → 直接读旧 cache
- And 未拿到锁的响应 200 + 旧 payload；日志 `graph_insights_cache_hit{reason:'advisory_lock_held'}`
- And 最终 cache 只被 UPSERT 一次

## POST /api/insights/dismiss

**Scenario: 正常 dismiss**
- Given 调用者 u@x 有 space_id=12 的 Viewer
- When `POST /api/insights/dismiss {spaceId:12, insight_key:'abc...'}`
- Then 响应 204 No Content
- And `metadata_graph_insight_dismissed` 新增一行 `(u@x, 12, 'abc...', now())`

**Scenario: 重复 dismiss 幂等**
- Given 该 `(u@x, 12, 'abc...')` 行已存在
- When 再次 POST
- Then 响应 204（UPSERT on conflict do nothing），不新增行

**Scenario: 越权 dismiss**
- Given u@x 对 space_id=12 无 Viewer
- When POST
- Then 响应 403

**Scenario: DELETE 恢复**
- Given `(u@x, 12, 'abc...')` 已 dismiss
- When `DELETE /api/insights/dismiss {spaceId:12, insight_key:'abc...'}`
- Then 响应 204
- And dismiss 表中该行被删除
- And 下次 GET 该 insight_key 重新出现在 payload

## Deep Research 主题生成

**Scenario: 生成研究主题**
- Given payload 里有一条 bridges `{asset_id:882, name:'架构总览', bridge_communities_count:4}`
- When 前端调后端的主题生成端点（内部函数：`generateDeepResearchTopic(insight)`）
- Then 返回 `{topic:'架构总览与其他 3 个相关知识簇的深层关联', query_hint: '...'}`
- And 调用了 `llmProviders.chat`（走 `GRAPH_INSIGHTS_TOPIC_MODEL` 配置，空则取 ragPipeline 同模型）

**Scenario: 生成失败降级**
- Given LLM provider 超时
- When `generateDeepResearchTopic(insight)`
- Then 返回兜底模板 `{topic: '扩展 ${insight.name} 的关联知识', query_hint: ''}`
- And 日志 WARN `graph_insights_topic_fallback`

**Scenario: Deep Research 复用 runRagPipeline**
- Given 用户在前端编辑完主题为 `"架构总览 vs 微服务相关性"`
- When 前端调 `POST /api/agent/dispatch {intent:'knowledge_qa', question:'架构总览 vs ...', spaceId:12, assetIds:[882]}`
- Then 响应为既有 SSE 流（ragPipeline 契约）
- And `runRagPipeline` 的 `opts.assetIds=[882]` 与 `opts.spaceId=12` 生效
- And ADR-24 的 "assetIds 非空 → 跳过 short-circuit" 逻辑已验证触发

## 降级

**Scenario: AGE 不可达**
- Given `graphDb.ts` 的连接 health check 失败
- When `GET /api/insights?spaceId=12`
- Then 响应 503 `{code:'KG_UNAVAILABLE', message:'知识图谱暂不可用'}`
- And 不触发 cache 写入

**Scenario: |E| 超限**
- Given 子图 `|E|=12000 > GRAPH_INSIGHTS_MAX_EDGES=10000`
- When 计算
- Then payload `degraded=true, reason:'graph_too_large'`
- And Louvain 未被调用（日志 `graph_insights_louvain_skipped{reason:'graph_too_large'}`）

**Scenario: Louvain 抛异常**
- Given `graphology-communities-louvain` 内部异常（如 NaN modularity）
- When 计算
- Then payload `degraded=true, reason:'louvain_exception'`
- And surprises/sparse 回落为 `[]`，bridges 用 HAS_TAG 回退
- And 错误被 try/catch 吞掉，API 仍 200

**Scenario: Space 无资产**
- Given space_id=99 存在但无资产
- When API
- Then 响应 200 + `{stats:{asset_count:0,...}, isolated:[], bridges:[], surprises:[], sparse:[], degraded:false}`

## 环境变量

**Scenario: GRAPH_INSIGHTS_ENABLED=false 全局关停**
- Given env `GRAPH_INSIGHTS_ENABLED=false`
- When 任一 `/api/insights*` 请求
- Then 响应 503 `{code:'FEATURE_DISABLED'}`
- And 启动日志出现 `[insights] disabled by env`

**Scenario: 权重 env 覆盖生效**
- Given `GRAPH_INSIGHTS_WEIGHT_CROSS_COMMUNITY=5.0`
- When 计算 surprises
- Then `surprise_score` 的 cross_community 项系数为 5.0 而非默认 3.0

## 并发与可观测性

**Scenario: 结构化日志**
- When 任意 `/api/insights` 请求触发重算
- Then stdout 出现一行 `graph_insights_computed` JSON 日志，含 `space_id, duration_ms, asset_count, edge_count, communities, degraded`

**Scenario: 冷启 30s 规则（ADR-37）**
- Given 本地 qa-service 冷启
- When 服务启动后 30s 内
- Then 日志无 graph-insights 相关错误、无 `pg error`、无 `AGE query failed`

## 前端（验收用，不约束实现路径）

**Scenario: 进入 /knowledge/insights 展示 4 个卡片类别**
- Given 用户已登录，选择了一个 space
- When 访问 `/knowledge/insights`
- Then 页面渲染 "孤立页面 / 桥接节点 / 惊奇连接 / 稀疏社区" 四个分组
- And 每个分组显示最多 10 条，超过显示"展开更多"

**Scenario: 点击 dismiss**
- Given 某孤立页面 insight 卡片可见
- When 用户点击"不再提醒"按钮
- Then 乐观更新隐藏该卡片
- And 后台 `POST /api/insights/dismiss` 响应 204 后保持隐藏
- And 若后端返回 5xx，前端恢复显示 + toast 报错

**Scenario: Deep Research 对话框**
- Given 某 bridge 卡片有 "Deep Research" 按钮
- When 点击
- Then 打开对话框，自动生成研究主题（loading 状态 < 3s）
- And 主题与 query 可编辑
- And 点"开始研究"触发 `POST /api/agent/dispatch`，跳转到 QA 页面流式回答

## Eval 无回归

**Scenario: pnpm eval-recall 维持 1.000**
- Given 本 change 合并后
- When 跑 `pnpm eval-recall eval/gm-liftgate32-v2.jsonl`
- Then recall@5 = 1.000（与 PROGRESS-SNAPSHOT-2026-04-24-ontology §八 一致）
- And recall@1 ≥ 0.973
