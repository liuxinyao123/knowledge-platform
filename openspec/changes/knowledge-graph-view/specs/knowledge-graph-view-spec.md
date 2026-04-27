# Spec: knowledge-graph-view

## GET /api/kg/graph

**Scenario: happy path 返回完整 payload**
- Given Space id=12 在 AGE 有 100 个 :Asset 节点 + 250 个 CO_CITED 边 + 30 个 :Tag 节点 + 80 个 HAS_TAG 边
- When `GET /api/kg/graph?spaceId=12`（已登录、有 Viewer）
- Then 200 + `{space_id:12, empty:false, truncated:false, stats:{node_count:130, edge_count:330}, nodes:[...], edges:[...]}`
- And `nodes` 含 `Asset.type` 字段（pdf / md / xlsx 等）；Tag 节点 `type='_tag'`
- And `edges` 仅含 `CO_CITED` 和 `HAS_TAG` 两类
- And 日志出现 `kg_graph_loaded{space_id:12, node_count:130, edge_count:330, truncated:false, duration_ms:<N>}`

**Scenario: 缺 spaceId → 400**
- When `GET /api/kg/graph`（无 spaceId）
- Then 400 `{code:'SPACE_ID_REQUIRED'}`

**Scenario: 越权 → 403**
- Given 调用者对 space_id=12 无 Viewer 权限
- When 请求
- Then 403 forbidden

**Scenario: 匿名 → 401**
- When 无 Authorization
- Then 401

**Scenario: 老 Space 在 AGE 无 :Space 节点**
- Given space_id=99 在 PG `space` 表存在，但 AGE 从未写过 `(:Space {id:99})`
- When 请求
- Then 200 + `{space_id:99, empty:true, hint:'space_not_in_graph', nodes:[], edges:[], stats:{node_count:0, edge_count:0}}`
- And 路由**不**触发任何 AGE 写入

**Scenario: 节点超限触发截断**
- Given Space 内 :Asset + :Tag 共 1200 个，CO_CITED + HAS_TAG 共 4500
- And `KG_GRAPH_MAX_NODES=800` / `KG_GRAPH_MAX_EDGES=3000`
- When 请求
- Then 200 + `truncated:true`
- And `nodes.length === 800`（按 degree 降序）
- And `edges.length ≤ 3000`（仅保留两端在 nodes 集合内的边，超限按 weight 降序截）

**Scenario: AGE 不可达 → 503**
- Given `isGraphEnabled() === false`
- When 请求
- Then 503 `{code:'KG_UNAVAILABLE'}`

**Scenario: payload 节点 / 边形态校验**
- When happy path
- Then 每个节点有 `{id, label, type, degree}` 四字段，无多余字段
- And 每条边有 `{source, target, kind, weight?}`，weight 仅 CO_CITED 才有
- And `id` 形如 `'asset:N'` 或 `'tag:NAME'`，无碰撞

## 节点截断规则

**Scenario: 截断按度数降序**
- Given 1000 节点，度数分布 [50, 49, 48, ..., 1, 0]，MAX_NODES=800
- When 截断
- Then 保留下标 0~799（度数 50 到度数 0+ 部分）
- And 度数最低的 200 个被丢弃

**Scenario: 截断后边集自动收窄**
- Given 截断后保留 800 节点；原 4500 条边里有 3500 条两端均在保留集
- When MAX_EDGES=3000
- Then `edges.length === 3000`（按 weight 降序，无 weight 视为 1）
- And 两端不在保留集的 1000 条边被全部丢弃（早于 MAX_EDGES 截断）

## ACL 与多 Space

**Scenario: payload 内 assetId 二次访问也被 ACL 拦**
- Given 调用者对 space_id=12 有 Viewer，但对 asset_id=999（属于 space 7）无访问
- When `GET /api/kg/graph?spaceId=12` 不含 asset:999；调用者拿 `asset:999` 去查 `/api/assets/999`
- Then `/api/assets/999` 返 403（既有 ACL 路径不变）
- And 本路由 payload 内不会出现非本 Space 的 asset

## 缓存 / 频率

**Scenario: 不缓存（v1 简单）**
- Given 同一调用者短时间连续两次 `GET /api/kg/graph?spaceId=12`
- When 两次都到达
- Then 两次都触发 AGE 子图查询（无 cache）
- And 两次响应 `generated_at` 不同
- Note: v2 可选加缓存层，与 graph-insights 同模式

## 前端（验收用，不约束实现）

**Scenario: 进入 /knowledge-graph 渲染力导向图**
- Given Space 已选，payload non-empty
- When 页面 mount
- Then `SigmaGraph.tsx` 通过 React.lazy 懒加载完成
- And ForceAtlas2 跑 100 iter 后节点位置稳定（≤ 500ms 主线程）
- And 节点按 Asset.type 着色

**Scenario: empty:true 显示 banner**
- Given API 返 empty:true, hint:'space_not_in_graph'
- When 渲染
- Then 页面显示 banner "此 Space 在知识图谱中暂无数据。请重新 ingest 一份资料以触发图谱写入。"
- And 不渲染 sigma canvas

**Scenario: truncated:true 显示警告 banner**
- Given truncated:true
- When 渲染
- Then 顶部黄色 banner "图谱已截断，仅显示度数最高的 N 个节点"

**Scenario: hover 节点高亮邻居**
- Given 已渲染含 nodes [A,B,C,D]，边 [A-B, A-C, B-D]
- When 鼠标悬停 A
- Then A、B、C 不变；D dim 至 `#e5e7eb`
- And 边 A-B、A-C 高亮 `#10b981` 加粗；B-D 隐藏
- When 鼠标离开
- Then 全部恢复

**Scenario: 单击 vs 双击**
- Given hover 在 asset:103
- When 单击
- Then HoverTooltip pinned 显示 `{label, type, degree, asset_id:103}`
- When 双击 asset:103
- Then `navigate('/assets/103')` 跳转
- When 双击 tag:云原生
- Then noop（Tag 节点不可跳转）

**Scenario: stats bar 链接到 /insights**
- Given API 返 nodes/edges
- And 调 `/api/insights?spaceId=N` 拿到 isolated:5, bridges:2, surprises:1, sparse:1
- When 渲染 stats bar
- Then 显示 "节点 N · 边 M · 上次刷新 X 秒前 · 查看 9 条洞察 →"
- And 点击 "查看 9 条洞察" 跳 `/insights`

## 环境变量

**Scenario: KG_GRAPH_MAX_NODES env 覆盖**
- Given `KG_GRAPH_MAX_NODES=300`
- When 请求 1000 节点的 Space
- Then `nodes.length === 300, truncated:true`

**Scenario: KG_GRAPH_FORCE_ATLAS_ITER 影响前端**
- Given `KG_GRAPH_FORCE_ATLAS_ITER=200`（前端环境变量须 build 时打入；v1 用编译期常量）
- When 渲染
- Then ForceAtlas2 iter 数为 200
- Note: v1 实现可硬编码 100，env 仅供 backend 用；前端常量留 v2 调

## Eval 无回归

**Scenario: pnpm eval-recall 维持 1.000**
- When `node scripts/eval-recall.mjs eval/gm-liftgate32-v2.jsonl`
- Then recall@5 = 1.000（本 change 不改 RAG 链路）
