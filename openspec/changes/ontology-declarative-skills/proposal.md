# Proposal: Declarative Skills · MCP 服务声明式技能框架

## Problem

`apps/mcp-service` 当前只有两个硬编码工具（`search_knowledge` / `get_page_content`，见 `openspec/changes/mcp-service/`）。PolarDB-PG Ontology 文章提出的"Skill 框架"要求：

- 一个 `.skill.yaml` 文件即可把 Ontology API（query / traverse / path / action）暴露成 Agent 可调用工具；
- Agent 据此做"证据驱动的探索式推理"，无需额外编码；
- 同一套框架适用多场景（运维诊断、销售分析、IT 资产管理等），只需切换数据集。

当前硬编码路径的问题：

- 每增一个工具都要改 TypeScript 代码（`tools/*.ts` + `server.ts` 注册 + `mcp-schema.json` 同步）；
- `mcp-schema.json` 是手工维护，容易与代码漂移；
- 无法给外部接入方（Notebook / 外部 Agent）提供"配置化启用子集"能力；
- 没有统一入口调 `qa-service` 的 Ontology Context 与 Action API。

## Scope（本 change）

1. **声明式 Skill 格式**：新定义 `skills/<name>.skill.yaml` 规范（input schema / output schema / backend 调用映射）。
2. **Skill Loader**：`apps/mcp-service/src/skillLoader.ts` —— 启动时扫描 `skills/` 目录，把每个 yaml 编译成 MCP Tool 注册。
3. **Hook 机制**：可选 `skills/<name>.hook.ts` 承载声明式无法表达的复杂逻辑（映射转换 / 条件过滤）。
4. **Backend Proxy**：`skills/_lib/backendProxy.ts`，统一封装对 `qa-service` 的调用（`/api/ontology/*` / `/api/actions/*`），内建鉴权头传递与超时。
5. **`mcp-schema.json` 自动生成**：不再手写，从已加载的 Skill 反射出来；构建时命令 `pnpm --filter mcp-service schema:build`。
6. **内置 Skill 包**：本 change 只**定义**以下 Skill 的 YAML 契约，实现放下游执行方：
   - `ontology.query_chunks` — 语义召回（代理 `qa-service` 的 `/api/ingest/search` 或等价接口）
   - `ontology.traverse_asset` — 代理 `/api/ontology/context`
   - `ontology.path_between` — 代理 AGE 两点路径查找
   - `ontology.match_tag` — 基于 Tag `semantic_embedding` 做自然语言匹配
   - `action.execute` — 代理 `POST /api/actions/:name/run`
   - `action.status` — 代理 `GET /api/actions/runs/:id`
7. **向后兼容**：既有 `search_knowledge` / `get_page_content` 两个工具迁移为 YAML + hook 形式，**工具名与 I/O 完全不变**，老客户端零感知。

## Out of Scope

- 修改 MCP Transport 层（stdio / HTTP，继续沿用 ADR/change `mcp-service`）；
- 给 Skill 加"链式调用"或"pipeline" DSL（未决问题 OQ-ONT-3）；
- Skill 的热重载（本期启动时静态加载即可）；
- Skill 级别的 A/B / 灰度（可在后续 change 追加）；
- 新增 BookStack 写操作工具；
- 在 `qa-service` 内再嵌一份 skill loader（Skill **只在 mcp-service 里**，qa-service 暴露 HTTP 给 skill 调用）；
- Skill 市场 / 可视化编辑器（仅 YAML 文件）。

## Success Metrics

- 新增任意 Skill 只需 1 个 YAML 文件（+ 可选 hook），**零改动 server.ts**；
- `mcp-schema.json` 与 YAML 一致性由 CI 校验（`pnpm schema:check`）；
- 老的 `search_knowledge` / `get_page_content` 行为无 regression（mcp-service 现有测试全过）；
- 本 change 契约合并后，下游 `ontology-action-framework` 和 `ontology-oag-retrieval` 的 HTTP 端点可被 Skill 无改动消费。
