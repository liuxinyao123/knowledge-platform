# apps/openviking-service

OpenViking sidecar —— 给 `knowledge-platform` 的 Agent 提供跨会话长期记忆。

> 本目录是 docker 镜像的构建上下文，不是 Node 工程。它**不**参与 pnpm workspace 构建。

## 这是什么

[OpenViking](https://github.com/volcengine/OpenViking) 是字节跳动火山引擎团队的开源 Agent 上下文数据库，把"memory / resources / skills"用 `viking://` 文件系统范式管理，并自动做 L0 摘要 / L1 概览 / L2 全文 三级分级。

我们这一轮（方案 A · 工作流 C 实验）只用它的 **memory** 那一面，存：

- `viking://user/<id>/preferences/...` 用户偏好
- `viking://user/<id>/entities/...` 用户语境里出现过的实体
- `viking://user/<id>/sessions/<sid>/...` 会话原文 + 摘要

不同步 BookStack Page 进 `viking://resources/`，那是后续方案的事。

详见 `docs/superpowers/specs/openviking-sidecar/{explore,design}.md`。

## 设计要点

- **自建 Dockerfile**，不用 quay.io/aicatalyst/openviking:latest，目的是锁版本 + 改 entrypoint 注入硅基 Qwen。
- **复用 EMBEDDING_API_KEY / EMBEDDING_BASE_URL**，OpenViking 内部当成 OpenAI 兼容协议调硅基。零新增 secret。
- **可选启动**：feature flag `VIKING_ENABLED=0` 默认不启用，集成代码降级 no-op。

## 本地构建 + 跑

```bash
# 1. 构建（首次约 3 分钟）
cd apps/openviking-service
docker build -t openviking-local:0.2.5 .

# 2. 单独跑（不走 compose），数据落本地 _data/
mkdir -p _data
docker run --rm -p 1933:1933 \
  -e EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1 \
  -e EMBEDDING_API_KEY=$YOUR_SILICONFLOW_KEY \
  -v "$(pwd)/_data:/data" \
  openviking-local:0.2.5

# 3. 健康检查
curl http://localhost:1933/healthz
```

## 走 docker-compose

直接：

```bash
# 在仓库根
VIKING_ENABLED=1 pnpm stack:up
```

会拉起 `openviking` 服务，qa-service 自动通过容器内域名 `http://openviking:1933` 调用。

## 接进 qa-service

集成点在 `apps/qa-service/src/services/viking/`。`KnowledgeQaAgent` 在 RAG 前后做两次旁路调用（recall + save），全程软超时 + fire-and-forget，主链路零阻塞。

## 故障排查

| 现象 | 原因 | 修法 |
|---|---|---|
| `docker build` 在 `pip install openviking` 卡住 | 网络代理 | 给 docker 配代理或换源 |
| 启动后 401 | `VIKING_ROOT_KEY` 设了但 qa-service 没传 | 两边都设或两边都留空 |
| 写记忆超时 5xx | 硅基限流 / `EMBEDDING_API_KEY` 失效 | 检查日志里的 LLM 调用错误 |
| qa-service 起不来 | 误把 viking 加进 qa_service 的 depends_on | 别加，design.md §1 明示解耦 |

## 退出 / 卸载

```bash
docker compose -f infra/docker-compose.yml stop openviking
docker compose -f infra/docker-compose.yml rm -f openviking
rm -rf infra/openviking_data    # 抹掉所有记忆
```

`apps/qa-service` 端只要把 `VIKING_ENABLED=0` 即可，所有调用立即降级 no-op。
