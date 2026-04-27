# ADR-31 (候选) · OpenViking sidecar 实验集成

- 日期：2026-04-26
- 状态：**候选 / 实验**（未验收，未进 main，方案 A）
- 工作流：C · `superpowers-feature-workflow`

## 背景

`knowledge-platform` 在三件事上有空缺：
1. Agent 没有跨会话长期记忆（`agent/dispatch` 跑完只在 AGE 写 `CITED` 边）；
2. RAG 是 flat chunk 拓扑，不利用 BookStack 的 Shelf/Book/Chapter/Page 层级；
3. Agent 的"技能"散落在 `services/skillBridge.ts` 等处，没有可被 ls/find 浏览的统一载体。

火山引擎团队 2026 年开源的 [OpenViking](https://github.com/volcengine/OpenViking) 是 Agent 上下文数据库，filesystem 范式 + L0/L1/L2 分级，恰好对应上述空缺。

我做了三种集成方案的评估（详见 `docs/superpowers/specs/openviking-sidecar/explore.md`）：
- **方案 A · sidecar MCP**（本 ADR）：把 OpenViking 当独立容器，仅用 memory 一面，最小侵入；
- 方案 B · 自实现 L0/L1/L2：不引入 OpenViking 服务，在 `services/ingestPipeline/` 自己生成分级；
- 方案 C · viking:// 全面替换：把 BookStack 全量同步进 viking，重写 RAG 入口。

## 决策

**先做方案 A 验证可行性**。理由：
- 风险最低：feature flag 默认 off，不进生产，不动 ragPipeline；
- 收益最直接：补"跨会话记忆"这一个空缺，前后端可见；
- 信息收集最快：跑通后能看到 L0/L1 分级在中文场景的实际表现，再决定要不要做方案 B；
- 退出成本最低：失败就关 flag，删容器，零债务。

## 范围

**做**：
- 自建 `apps/openviking-service/Dockerfile`（python:3.11-slim + pip install openviking==0.2.5）；
- `infra/docker-compose.yml` 加 openviking 服务，`profiles: [viking]` 控制默认不启动；
- `apps/qa-service/src/services/viking/` 加 client + memoryAdapter；
- `KnowledgeQaAgent` 在 RAG 前后旁路调用 recall + save，全程软超时 + fire-and-forget；
- 复用 `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL`（硅基 Qwen），零新增 secret；
- SSE 加 `viking_step` 事件，旧客户端忽略；
- 单测覆盖 client + memoryAdapter；
- `scripts/verify-viking.mjs` 跑 health/write/ls/find/read 五步烟测；
- `docs/verification/openviking-sidecar.md` 提供 6 个验收用例。

**不做**：
- 不同步 BookStack Page 进 `viking://resources/`（方案 C）；
- 不改 `ragPipeline.ts` 的七层兜底；
- 不引入 VikingBot Agent 框架；
- 不在 `mcp-service` 暴露 viking 工具（外部 Agent 接入推迟）；
- 不接入 Permissions V2 审计（按 principal id 路径隔离即可）。

## 关键技术决策

- **D1 镜像**：自建 Dockerfile（用户选择），不用 quay.io/aicatalyst/openviking:latest。
- **D2 LLM**：复用硅基 Qwen2.5-VL-72B，和 PDF v2 VLM 一致。
- **D3 集成位**：仅改 `KnowledgeQaAgent`，不动 RAG 内部。
- **D4 flag**：`VIKING_ENABLED=0` 默认。
- **D5 路径隔离**：`viking://user/<principal.id>/sessions/<sid>/...`，client 层硬编码 prefix 校验。
- **D6 软超时**：recall 200ms / save 1000ms，超时全部降级 no-op + 每分钟最多 1 条 warn。

## 退出条件（方案 A 不通过的红线）

任一触发即关 flag、删容器、本 ADR 状态置 `Rejected`：

1. OpenViking 镜像构建失败 ≥ 2 次仍不通；
2. health 持续 5xx 超过 1 小时；
3. enabled 时 GM-LIFTGATE32 召回率回退 > 5pp；
4. 多用户并发下出现路径串污（即便 client 已校验，仍出现跨 principal 数据）；
5. 硅基限流频繁导致写入失败 > 30%。

## 验收

按 `docs/verification/openviking-sidecar.md` 的 6 个用例。验收结果回填到本文件末尾。

## 后续

- 若方案 A 通过：写入 `archive` 推方案 B（在 ingest 自实现 L0），把 BookStack Page 抽 L0 进 pgvector 旁路；
- 若方案 A 不通过：本 ADR 状态置 `Rejected`，但保留 `docs/superpowers/specs/openviking-sidecar/` 作为调研存档；
- 任何情况下都不直接做方案 C（viking:// 全面替换）—— 那是产品定位级别的决策，需要单独 P0 走工作流 A。

## 参考

- explore.md / design.md：`docs/superpowers/specs/openviking-sidecar/`
- impl-plan：`docs/superpowers/plans/openviking-sidecar-impl-plan.md`
- 验收手册：`docs/verification/openviking-sidecar.md`
- OpenViking 官方：<https://github.com/volcengine/OpenViking>
- L0/L1/L2 概念：<https://github.com/volcengine/OpenViking/blob/main/docs/en/concepts/03-context-layers.md>
- LoCoMo10 报告：见官方 README，号称对比 baseline 召回 +49% / token -83%

---

## 验收结果

> 待填。手动跑完 6 个用例后回填。
