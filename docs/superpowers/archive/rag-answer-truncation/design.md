# Explore · RAG 回答截断 + Reranker 0 分（BUG-01）

> 工作流：B · Explore 阶段
> 改动对象：`apps/qa-service/src/services/{ragPipeline,reranker,llm}.ts` + 相关 routes
> 日期：2026-04-23

## 1. 现象（从用户 2026/4/23 自动化测试报告）

- 问题："知识图谱是什么"
- 现象 A：答复只输出了**两个字"知识"** 然后流结束
- 现象 B：trace 里 reranker **前 5 分数全是 `0.00 / 0.00 / 0.00 / 0.00 / 0.00`**
- 现象 C：引用文档置信度**全 0%**
- 相同请求在知识问答 (`/qa`) 和 Agent (`/agent`) 两处都能复现

## 2. 代码事实（静态分析得出）

### 2.1 Reranker 管道 (`services/ragPipeline.ts:173-199` + `services/reranker.ts`)

```
filtered = 向量召回后用户权限过滤下来的 top-N chunk（N = RECALL_TOP_N）
docs = filtered.map(c => c.chunk_content)            // 纯字符串数组
ranked = await rerank(question, docs, targetTopK)
→ POST {RERANKER_BASE_URL}/rerank
  body: { model, query, documents }
← response.results[].{ index, relevance_score | score } → Number(x ?? 0)
```

**关键点**：`Number(r.relevance_score ?? r.score ?? 0)` —— 如果 SiliconFlow 返回的 results 里字段名**既不是 `relevance_score` 也不是 `score`**（比如叫 `logit` / `probability` / `similarity_score`），**所有候选都 fallback 到 0**，完美匹配用户看到的"全 0.00"现象。

### 2.2 LLM 生成 (`services/ragPipeline.ts:368-379` + `services/llm.ts:128-166`)

```
stream = chatStream(messages, { model: getLlmModel(), maxTokens: 2000, system })
for await (const text of stream) emit({ type: 'content', text })
```

`chatStream` 解析 OpenAI 兼容的 SSE：`data: {...}\n\n` → JSON → `choices[0].delta.content` → yield。
遇到 `data: [DONE]` 就结束。

`maxTokens=2000`，不是被 tokens 卡住。

### 2.3 前端 SSE 消费

入口是 `/api/qa/ask` 兼容壳 → `dispatchHandler` 发 SSE events 给前端。事件类型有 `content` / `rag_step` / `rag_done` / `agent_selected` / `error` / `done`。

如果前端只吃 `content` 事件的第一次 delta，那就会只显示两个字 —— 但这和现有消费代码不符合，需要抓 network panel 确认。

## 3. 根因假设集（按概率排序）

| # | 假设 | 支持证据 | 反证 | 验证命令 |
|---|---|---|---|---|
| **H1** | SiliconFlow rerank API 返回的字段名**不是** `relevance_score` / `score`（可能叫 `logit` / `score_val` / `probability`）→ 全 fallback 0 | 代码 L109 `Number(r.relevance_score ?? r.score ?? 0)`；全 0 现象完美匹配；SiliconFlow 文档上字段名历史上确实变过 | 若果真全 0，`ranked` 仍会返回（只是排序无意义），后续 LLM 生成应正常 | 见 §4 cmd **R1** |
| **H2** | chunk 本身就是乱码（OCR 碎片 + JSON error blob，BUG-02/14 同源），reranker 真的对所有候选打 0 分 | 批 D 刚修的 tagExtract OCR 过滤 + Search JSON 暴露证据；库里存脏数据事实 | 即便如此"0 分全同"概率极低，正常模型会分散打 0.01/0.03 等 | 见 §4 cmd **R2** |
| **H3** | LLM 返回的 stream 确实只有一个 delta `{content:"知识"}`，模型被 context 毒化（脏 chunk + 严谨 prompt "找不到就承认找不到"）直接短回答 | 问题是知识图谱定义，若 context 全是 OCR 乱码，模型可能回"知识库中未找到..."然后被截断 | "知识"两个字单独成句不像完整回答；模型 normally 不会这么短 | 见 §4 cmd **L1** |
| **H4** | LLM API 层面 stream 中途断开（网络/代理/timeout）；`chatStream` 的 for-await 吞 reader.read 失败 | chatStream L146 `for (;;) { const { done, value } = await reader.read() }`；若 reader 抛异常会冒泡到上层 ragPipeline，理论上会被捕获 emit error | 用户没报告 error 事件 | 见 §4 cmd **L2** |
| **H5** | 前端 SSE 消费只累积第一个 content 事件 | Agent 和 QA 都复现 → 两处都有同样的前端 bug 概率低 | 代码不同（QA 走 qa 壳，Agent 走 dispatchHandler）不太可能共享同一 bug | 见 §4 cmd **F1** |

## 4. 需要用户本机跑的验证命令

### R1 · 最关键一条：打开 SiliconFlow rerank 原始 response

```bash
# 用你真实的 SILICONFLOW_API_KEY 替换 <KEY>
curl -sS https://api.siliconflow.cn/v1/rerank \
  -H "Authorization: Bearer <KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "BAAI/bge-reranker-v2-m3",
    "query": "知识图谱是什么",
    "documents": [
      "知识图谱（Knowledge Graph）是一种语义网络，用节点表示实体、用边表示实体间的关系。",
      "苹果是一种水果，常见颜色有红、绿、黄。",
      "PostgreSQL 是一个开源关系数据库。"
    ]
  }' | jq
```

**预期**：response 有 `results: [{ index, relevance_score }]` 形态。如果看到的字段叫别的（例如 `logit`），H1 立即坐实。

### R2 · 看实际传给 rerank 的 documents 内容

在 `apps/qa-service/src/services/ragPipeline.ts:178` 临时加一行：
```ts
const docs = filtered.map((c) => c.chunk_content)
console.log('[rerank-dbg]', { q: question, docs: docs.slice(0, 3).map((d) => d.slice(0, 80)) })
const ranked = await rerank(question, docs, targetTopK)
```

重启 qa-service，重问一次。`.dev-logs/qa-service.log` 里 grep `rerank-dbg` 看前 3 个 chunk 的前 80 字 —— 若全是 OCR 乱码，H2 坐实。

### L1 · 看 LLM 原始 response

同文件 L368 附近加：
```ts
for await (const text of stream) {
  if (signal.aborted) break
  console.log('[llm-chunk]', JSON.stringify(text).slice(0, 100))   // 临时
  emit({ type: 'content', text })
}
```

重启 + 重问。`grep llm-chunk .dev-logs/qa-service.log` —— 看到底 LLM 吐了几个 chunk 以及每个 chunk 的内容。若只吐了一次 `"知识"` 然后 [DONE]，H3 坐实。

### L2 · 看 chatStream 迭代异常

`chatStream` 没加 try/catch。如果 `reader.read()` 抛，错误会冒到 ragPipeline → dispatchHandler catch → emit `error`。
打开浏览器 DevTools → Network → 找那条 SSE 请求 → Preview 面板看**最后一个事件是不是 error**。

### F1 · 浏览器 SSE 事件流原文

DevTools → Network → 按 problematic 问题再发一次 → 找 `/api/qa/ask` 或 `/api/agent/dispatch` → **EventStream** tab（不是 Preview）。把所有 events 截图或复制粘贴前 30 行给我。

### 附加：LLM 配置侦查

```bash
# qa-service 启动日志最后一行就有关键信息；之前你贴过：
#   ✓ QA service → http://localhost:3001 | embeddings: on (https://api.siliconflow.cn/v1)
#     model=Qwen/Qwen3-Embedding-8B | auth=hs256
# 但不显示 reranker 状态和 LLM_MODEL。再跑：
grep -E "RERANK|LLM_MODEL|EMBEDDING" /path/to/knowledge-platform/apps/qa-service/.env
```

**关键问题**：
- `LLM_MODEL` 是否被改小了（比如 Qwen 7B 而不是默认的 72B）？
- `RERANKER_MODEL` 是不是真是 `BAAI/bge-reranker-v2-m3`？
- `RERANKER_API_KEY` 是否和 embedding 共用（缺 key 时 `isRerankerConfigured()=false`，根本不走 rerank 分支 —— 但用户看到了 "前 5 分数 0.00"，所以 key 肯定配了）

## 5. 立刻能做的防御性小改（不等用户信号）

即便根因要等信号，下面两处可以先修：

### D1 · 容错：rerank 如果字段名变了，兜底按字段遍历取第一个数字

```ts
// services/reranker.ts L109 附近
const candidates = ['relevance_score', 'score', 'logit', 'probability', 'similarity_score', 'similarity']
let score = 0
for (const k of candidates) {
  const v = Number((r as Record<string, unknown>)[k])
  if (Number.isFinite(v)) { score = v; break }
}
```

### D2 · Rerank 全 0 时触发"降级到向量序"

```ts
// ragPipeline.ts L181 附近
const allZero = ranked.length > 0 && ranked.every((r) => r.score === 0)
if (allZero) {
  emit({ type: 'rag_step', icon: '⚠️', label: 'Reranker 返全 0 分，疑似 response 字段漂移；降级到向量检索序' })
  return filtered.slice(0, targetTopK)
}
```

如果 D1 能帮我们用字段名遍历拿到真实分数，D2 就极少触发；如果 D1 也拿不到，D2 至少避免让 LLM 吃到一堆 "等价烂" 的 chunk（按向量分数排至少有排序信息）。

### D3 · chatStream 加守护：捕获 reader 异常 + 空流警告

```ts
// llm.ts chatStream 末尾
// 若整个 stream 都没 yield 过任何 text，emit 一个明确的错误
let yielded = 0
for await (...) { ... yielded++; yield text }
if (yielded === 0) throw new Error('LLM stream returned no content chunks')
```

## 6. 建议 Lock scope（看根因确认后再决定）

| 根因 | Lock scope |
|---|---|
| H1 坐实（字段名漂移） | 最小 scope：`reranker.ts` 多字段名兜底 + 单测三种字段命名；不动 ragPipeline 接口契约 |
| H2 坐实（chunk 脏） | 范围扩大到 ingest 层：过滤"error JSON body" + 配合批 D 的 tagExtract 一起归档 |
| H3 坐实（LLM 被 context 毒化） | Prompt 改造 + top-K 截断策略；也要叠加 H1/H2 的根治 |
| H4 坐实（LLM stream 中断） | llm.ts `chatStream` 守护 + 重试；改动面大 |
| H5 坐实（前端 bug）| apps/web 的 SSE 消费层，Lock scope 局限在 QA 页和 Agent 页 |

Explore 阶段**不承诺 Lock scope**，等拿到 §4 的信号后再写 proposal。

## 7. 交互清单（等用户回贴）

- [ ] R1 curl 结果
- [ ] R2 `grep rerank-dbg` 日志（或贴一次 problematic query 的 qa-service.log 全段）
- [ ] L1 `grep llm-chunk` 日志
- [ ] L2 浏览器 Network Preview 最后一个 event
- [ ] F1 浏览器 EventStream tab 前 30 行
- [ ] .env 里 LLM_MODEL / RERANKER_MODEL / RERANKER_API_KEY 配置值（只报字段是否存在、模型名；key 不用贴）

任一组能拿到即可收敛。**最高优先级是 R1**（一条 curl），能直接区分 H1 vs H2。
