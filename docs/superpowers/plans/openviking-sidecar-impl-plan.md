# OpenViking Sidecar — Impl Plan

> 配套 `docs/superpowers/specs/openviking-sidecar/{explore,design}.md`。
> 工作流：C。每一步独立 PR-able，按顺序执行，可暂停。

---

## Step 1 · openviking 容器骨架（半天）

新增文件：

- `apps/openviking-service/Dockerfile` —— python:3.11-slim + `pip install openviking==<lock>` + `EXPOSE 1933`
- `apps/openviking-service/entrypoint.sh` —— 注入 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / model 环境变量后 `exec ov serve --host 0.0.0.0 --port 1933 --data-dir /data`
- `apps/openviking-service/.env.example` —— 注释完整的环境变量样例
- `apps/openviking-service/README.md` —— 说明依赖、构建、本地启动、和 qa-service 联调

验收：`cd apps/openviking-service && docker build -t openviking-local .`，`docker run --rm -p 1933:1933 -v $(pwd)/_data:/data openviking-local`，curl 能拿到 health。

## Step 2 · 改 docker-compose（1 小时）

- `infra/docker-compose.yml` 加 `openviking` 服务，build context 指向 `apps/openviking-service`，端口 `1933:1933`，挂卷 `./openviking_data:/data`，健康检查 30 秒间隔。
- `qa_service` 不加 `depends_on: openviking`（保持解耦，关 viking 也能起 qa）。
- 注入 `VIKING_BASE_URL=http://openviking:1933` / `VIKING_ENABLED=${VIKING_ENABLED:-0}` 到 qa_service。
- `infra/.env.example`（如已有则改、没有则新建）补 `VIKING_*` 变量。

验收：`docker compose -f infra/docker-compose.yml config` 通过；`pnpm stack:up` 能起来 6 个容器。

## Step 3 · vikingClient 模块（半天）

- 新增 `apps/qa-service/src/services/viking/types.ts`、`client.ts`、`memoryAdapter.ts`、`index.ts`。
- 全部用 `axios`（已是依赖），无新外部包。
- 单测：`apps/qa-service/src/__tests__/viking.client.test.ts`（mock axios，验 path 强制 prefix、超时降级、disabled no-op）。

验收：`pnpm --filter qa-service test viking.client` 全绿；`tsc --noEmit` 过。

## Step 4 · KnowledgeQaAgent 接入（半天）

- 改 `apps/qa-service/src/agent/agents/KnowledgeQaAgent.ts`，按 design.md §3 注入 recall + save。
- 加单测：`apps/qa-service/src/__tests__/agent.knowledgeQa.viking.test.ts`，stub vikingClient，验：(a) disabled 时 RAG 行为不变；(b) enabled 时 recall 注入 history 头部；(c) recall 超时不抛。
- 不改 `ragPipeline.ts`。

验收：`pnpm --filter qa-service test` 全绿；现有 207 用例不退化。

## Step 5 · 烟测脚本 + 验收文档（1 小时）

- `scripts/verify-viking.mjs`：Node 22 + axios，跑 health → write → ls → find → read 五步，输出 PASS/FAIL。
- `docs/verification/openviking-sidecar.md`：完整验收手册（启动步骤、用例、预期 SSE 事件样例、降级矩阵 e2e 检查）。
- `scripts/dev-up.sh` / `dev-status.sh` 不强改，但加注释说明 viking 是可选。

验收：手动跑通验收手册的 6 个用例。

## Step 6 · ADR 候选 + Memory 同步（半小时）

- `.superpowers-memory/decisions/2026-04-26-31-openviking-sidecar-experiment.md`：写明本轮目的、选择、不做的事、退出条件。
- `.superpowers-memory/integrations.md` 末尾追加 OpenViking 一节。
- `.superpowers-memory/open-questions.md` 加 1–2 条留给方案 B 的开放问题（L0 自实现 vs 复用 viking、resources/ 同步策略）。

验收：人工 review，写进下一份 PROGRESS-SNAPSHOT。

---

## 总工时估算

约 2.5 工日（一个工程师），不含等 docker 构建拉镜像的 IO 时间。

## 退出条件

任一硬性指标不达标 → 停在 Step 5，把结论写进 ADR-31，**不**进 main：

- viking 镜像构建失败超过 2 次仍不通；
- viking 启动后 health 反复 5xx；
- enabled 时 RAG 召回率（GM-LIFTGATE32）回退超过 5%。

---
