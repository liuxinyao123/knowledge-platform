# ADR-35 · QA 联网检索 + 多模态图片附件

- 日期：2026-04-26
- 状态：**Accepted**
- 工作流：B 简化版（需求清晰 + 全套 e2e）
- 触发：用户 review 营销稿时发现 QA composer 的 🌐 / 🖼 是 UI 占位（"待接入"）

## 背景

QA 聊天框右下角已有三个按钮：「所有空间」下拉、🌐 globe、🖼 image、➤ 发送。前两个 icon 按钮原本只是 `title="待接入"` 的 placeholder，无任何后端支持。营销稿 / 客户 demo 看到这两个图标会期待真功能。

## 决策

**两件事一并落地，全栈 e2e**：

### 🌐 联网检索（webSearch）

- 后端 `services/webSearch.ts`：抽象 provider 层，默认实现 Tavily（agent-friendly 结构化搜索 API，1000/月免费），备选 Bing v7。
- env：`WEB_SEARCH_PROVIDER=tavily|bing|none` + 对应 `*_API_KEY`
- `agent/dispatch` 接 `web_search: boolean`；`KnowledgeQaAgent` → `runRagPipeline({webSearch})`
- ragPipeline 在 `generateAnswer` 之前调 webSearch，结果作 `[w1..wN]` 拼进 LLM context（与文档 `[N]` 区分），emit 新事件 `web_step`
- 前端 toggle 状态（紫色 active），未配置 provider 时后端跳过 + emit `rag_step ⚠️` warn

### 🖼 多模态 QA（image）

- 复用已部署的 Qwen2.5-VL-72B-Instruct（`INGEST_VLM_MODEL` 环境变量，PDF v2 已经在用）
- `agent/dispatch` 接 `image: { base64, mimeType }`；上限 8MB base64（约 6MB 原图）
- ragPipeline `generateAnswer` 当 `extras.image` 存在时：
  - 用户消息走 `ContentBlock[]` 格式：`[{type:'text', text}, {type:'image_url', image_url:{url:'data:...;base64,...'}}]`
  - 模型从 `getLlmModel()`（72B 文本）切到 `INGEST_VLM_MODEL`（72B 视觉）
- 前端：file picker (`accept="image/*"`) → FileReader 转 base64 → 缩略图预览 chip + 移除按钮 → send 后清空附件（webSearch toggle 保留）

## Decision Log

- **D1 Tavily 优先于 Bing**：Tavily 专为 agent / RAG 设计，返回结构化 snippet 直接可塞 LLM context；Bing 需要后处理。Bing 仅作合规备选。
- **D2 默认 provider=none**：私有部署默认不外发，env 显式配 key 才启用。前端 toggle 永远可点，未配置时后端 emit warn 不阻塞主链路。
- **D3 图片走多模态 LLM 而非走 ingest**：用户问"看图回答"时直接喂 VL 模型；不入库（避免污染检索）。
- **D4 复用 INGEST_VLM_MODEL env**：和 PDF v2 caption 用同一个模型变量，零新 secret，零新 LLM 接入。
- **D5 用户消息 ContentBlock[] 格式**：硅基/OpenAI 兼容协议都支持，`chatStream` 已支持（earlier ADR）。
- **D6 web 结果用 `[wN]` 编号**：和文档 `[N]` 区分，避免 LLM 引用混淆。
- **D7 6MB 前端 / 8MB base64 后端**：前端阻断减少无效请求；后端再 belt-and-suspenders 一道。
- **D8 webSearch.ts 软返 []**：永不抛，超时 / 限流 / 网络错都返空；主链路对故障无感。

## 兼容性

- 老客户端：不传 `web_search` / `image` 字段时行为完全不变；`SseEvent` 加 `web_step` 旧前端忽略未知 type。
- 老 RAG：未传 image / webSearch 时 `generateAnswer` 走原文本路径（model = `getLlmModel()`）。
- 私有内网部署：env `WEB_SEARCH_PROVIDER=none` 时前端 toggle 仍可点，但后端 emit `rag_step ⚠️` "联网检索未配置（缺 TAVILY/BING_API_KEY），跳过"，符合数据主权红线。

## 退出条件

任一触发即把 toggle 默认改不可见 + ADR 状态置 Rejected：
- Tavily / Bing 在生产环境延迟 p95 > 3s 严重拖慢首字（虽然有 5s 超时兜底）
- 多模态 VL 在中文图表识别准确率 < 70%
- 图片附件触发安全 / 合规审计警告

## 文件清单

新增：
- `apps/qa-service/src/services/webSearch.ts` · Tavily + Bing provider 抽象

修改：
- `apps/qa-service/src/agent/types.ts` · `AgentContext` 加 `webSearch` / `image`
- `apps/qa-service/src/agent/dispatchHandler.ts` · 解析 body.web_search / body.image，注入 ctx
- `apps/qa-service/src/agent/agents/KnowledgeQaAgent.ts` · 透传到 ragPipeline 的三处 call site
- `apps/qa-service/src/services/ragPipeline.ts` · `RunRagOptions` 加 webSearch/image；`generateAnswer` 接 extras；调用 webSearch + emit web_step
- `apps/qa-service/src/ragTypes.ts` · `SseEvent` 加 `web_step` + `WebStepPayload`
- `apps/web/src/knowledge/QA/index.tsx` · 两个按钮从占位变成有状态 toggle + file picker + 缩略图预览；`handleSend` 把 web_search / image 加进 dispatch body
- `apps/qa-service/.env.example` · 6 个 WEB_SEARCH_* 环境变量
- `infra/docker-compose.yml` · qa_service.environment 注入

## 集成指南

参见 `docs/integrations/mcp-quickstart.md`（已 8 工具全通）；多模态 / 联网走 web UI 即可，无需 mcp 改动。

## 后续

- [ ] 把 web hits 也写到右栏「引用」tab（当前只 emit `web_step` 但前端没消费 — 留给 D-2 follow-up）
- [ ] 联网结果走 reranker 做二次精排（当前直接拼 context 全喂）
- [ ] 多模态 + RAG 同时存在时，让 VL 模型也能引用文档（验证 prompt 是否兼容）
- [ ] 把 INGEST_VLM_MODEL 重命名成 VLM_MODEL（ingest 和 QA 共用，名字不再带 INGEST_ 前缀）
