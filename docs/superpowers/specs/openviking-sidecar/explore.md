# OpenViking Sidecar — Explore

> 工作流：C · `superpowers-feature-workflow`（独立 UI/集成实验，不锁 OpenSpec）
> 目的：把 ByteDance 火山引擎 OpenViking（Agent 上下文数据库，filesystem 范式 + L0/L1/L2 分级）作为 sidecar 接入 knowledge-platform，验证可行性。
> 不替代任何现有能力。

---

## 1. 动机

当前 `knowledge-platform` 在三件事上**有空缺**，恰好是 OpenViking 设计上要解决的：

1. **Agent 没有跨会话记忆**。`POST /api/agent/dispatch` 走完只在 Apache AGE 写 `CITED / CO_CITED` 边，但没有 user 偏好、entity 抽取、task memory 这层。
2. **召回是 flat chunk 拓扑**。BookStack 天然有 Shelves → Books → Chapters → Pages 四级，RAG 不利用。
3. **Agent 的"技能"无统一载体**。当前 `apps/qa-service/src/services/skillBridge.ts` 把 skill 当函数调用，没有"可被 Agent `ls / find` 浏览的资源/技能目录"。

OpenViking 的 `viking://` 协议（resources/ user/ agent/ 三类目录）+ L0(摘要)/L1(概览)/L2(全文) 分级正是补这三块。

参考资料：
- 官方仓库：<https://github.com/volcengine/OpenViking>
- 官方文档：<https://volcengine-openviking.mintlify.app/>
- L0/L1/L2 概念：<https://github.com/volcengine/OpenViking/blob/main/docs/en/concepts/03-context-layers.md>
- viking:// URI：<https://github.com/volcengine/OpenViking/blob/main/docs/en/concepts/04-viking-uri.md>
- LoCoMo10 报告（49% recall ↑ / 83% token ↓）：见官方 README。

## 2. 边界（这次要 / 不要做的）

**要做（方案 A 范围）**：

- 在 `apps/openviking-service/` 自建 Dockerfile，跑 `pip install openviking` 起 1933 端口的 REST 服务。
- 在 `infra/docker-compose.yml` 加一个 `openviking` 服务，挂 `./openviking_data` 持久化卷。
- 在 `apps/qa-service/src/services/viking/` 加一个轻量 HTTP 客户端（5 个方法：health / write / find / read / ls）。
- `KnowledgeQaAgent` 在 RAG 前后做两次旁路调用：开头 `recallMemory(question, principal)` 注入 system context；结尾 `saveMemory(qa_pair)` fire-and-forget。
- 全程 feature flag `VIKING_ENABLED` 默认 **off**，未启用时所有调用 no-op，主链路零影响。
- LLM/Embedding 走 `EMBEDDING_API_KEY` + `EMBEDDING_BASE_URL`（硅基 Qwen），不开外网。

**不做（留给后续 ADR）**：

- 不把 BookStack Page 同步进 viking://resources/——那是方案 B / C 的事，需要先确认权限模型耦合方案。
- 不改 `ragPipeline.ts` 的七层兜底——这是已经稳定的代码，本轮不动。
- 不引入 VikingBot 整套 Agent 框架——你们已经有自己的 `agent/registry.ts + dispatchHandler`。
- 不暴露 viking 数据给 `mcp-service` 对外——先内部用，外部 MCP 等接入稳定再说。
- 不接 Permissions V2 的写入审计——本轮 viking 数据按 user_id 隔离即可，不进 `acl_rule_audit`。

## 3. 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| OpenViking 镜像构建/运行失败（pip 依赖、Python 版本） | 中 | 高 | 自建 Dockerfile 锁版本 + 本地 docker build 试跑；失败回退方案 B（自实现 L0） |
| OpenViking 默认 LLM provider 不兼容硅基 Qwen | 中 | 中 | 启动参数注入 `OPENAI_BASE_URL=https://api.siliconflow.cn/v1` + 复用 `EMBEDDING_API_KEY`；不行就关掉 viking 自动 L0 写入，只用作存储 |
| 写入 viking 阻塞 RAG 主链路 | 低 | 高 | 全部 fire-and-forget + AbortController + 100ms 软超时；recall 失败降级到不注入 |
| 容器和 pgvector 抢资源 | 低 | 中 | docker-compose 不强制 depends_on；本机 dev 默认不起 viking |
| 多用户记忆串污 | 中 | 高 | 路径强制 `viking://user/<principal.id>/...`，client 层硬编码 prefix，不接受外部传 |
| 数据合规（用户输入持久化） | 中 | 高 | 默认 off + 文档明示风险；上生产前过 ADR-XX 单独审 |

## 4. 关键决策点

- **D1 · 镜像策略**：自建 `apps/openviking-service/Dockerfile`（用户选择 B），不用 quay.io/aicatalyst/openviking:latest。原因：可控、能锁版本、可改 entrypoint 注入硅基 BASE_URL。
- **D2 · LLM provider**：复用 `EMBEDDING_API_KEY` + `EMBEDDING_BASE_URL`（硅基 Qwen2.5-VL-72B），和现有 PDF v2 VLM、ingest 一致。
- **D3 · 集成位**：只动 `KnowledgeQaAgent`，不动 `ragPipeline`。最小入侵。
- **D4 · feature flag**：`VIKING_ENABLED` 默认 off；本机 dev 显式 `VIKING_ENABLED=1` 才起容器并接通。
- **D5 · 数据隔离**：viking 路径强制按 `principal.id` 命名空间隔离，client 层校验。

## 5. 成功标准

本轮验证通过的判据：

1. `docker compose up openviking` 起得来，`curl http://localhost:1933/healthz`（或 viking 自带的 health endpoint）返回 200。
2. `scripts/verify-viking.mjs` 跑通"写一条记忆 → ls → find → read"四步。
3. `VIKING_ENABLED=1 pnpm dev:up` 后，前端发起一次 QA，SSE 流里能看到 `viking_step` 事件至少 2 次（recall + save）。
4. `VIKING_ENABLED=0` 时 RAG 表现和当前完全一致（用 `eval-recall.mjs` 跑 GM-LIFTGATE32 一次对比）。
5. 关掉 openviking 容器，`VIKING_ENABLED=1` 仍能跑（client 降级到 no-op + WARN 一次）。

不通过的判据：

- 上述 1–5 任一失败 → 方案 A 阶段性结论"不可用"，写进 explore.md 末尾，转方案 B。

---
