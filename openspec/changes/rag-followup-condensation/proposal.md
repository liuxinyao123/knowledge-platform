# Proposal: RAG Follow-up Question Condensation

## Problem

`apps/qa-service/src/services/ragPipeline.ts` 的 retrieval 路径（`retrieveInitial`
/ `coarseFilterByL0` / `gradeDocs` / `rewriteQuestion`）**完全不使用对话历史**，
只把当前 turn 的 `question` 字符串送去做 embedding。

后果：连续多轮对话中的 follow-up question（"那你把原文发我" / "解释一下" /
"继续" / "它是谁写的" 等指代型短问题）被当成全新问题，跟历史上下文里真正涉及的
实体（如《道德经》）语义距离极远，rerank top-1 经常 < 0.05 触发
`RAG_NO_LLM_THRESHOLD` short-circuit，输出兜底文案"知识库里暂时没有与该问题
直接相关的内容"。

实测样本：
```
... [道德经第一章原文 retrieval 命中] ...
用户：那你把原文发我
助手：抱歉，知识库里**暂时没有**与该问题直接相关的内容。
     （检索相关性最高仅 0.027，低于可用阈值 0.05）
```

## Scope（本 Change）

1. **新增 follow-up 改写层**（`services/condenseQuestion.ts`）：
   - `looksLikeFollowUp(question)` 触发判定（导出供测）
   - `isCondenseEnabled()` env 探测（默认 on）
   - `condenseQuestion(question, history, emit)` 主函数：fast LLM 改写
   - 任何异常 / 触发条件不满足 → 透明回落原 question，不阻塞

2. **改写后 query 在 retrieval 路径用，generation 路径不动**（`services/ragPipeline.ts`）：
   - `runRagPipeline` 在 Step 0 计算 `retrievalQuestion = condenseQuestion(...)`
   - 替换 `adaptiveTopK` / `coarseFilterByL0` / `retrieveInitial` / `gradeDocs`
     / `rewriteQuestion` / `webSearch` 的 query 入参
   - **不动** `generateAnswer` / `recordCitations` / `isDataAdminQuestion` /
     `runDataAdminPipeline`（这些保留原 question + 完整 history）

3. **emit 一个 `🪄` rag_step 事件**让前端 / SSE 消费者看到改写发生 + 改写内容
   （仅成功改写且与原句不同时 emit，避免污染日志）

4. **env `RAG_CONDENSE_QUESTION_ENABLED`**（默认 on，false / 0 / off / no 关闭）

## Out of Scope（后续 Change）

- 改写 cache（同 question + history hash → 复用上次改写）—— 性价比低
- 改写质量量化 eval —— 等多文档 eval 集（D-003）
- 跟 step_back / hyde 合并成一个 LLM 调用 —— 语义不同（消歧 vs 泛化 vs 假设答案）
- B 工作流的"答案意图分类 + handler 分流"（D-002，独立 OpenSpec change
  `rag-intent-routing`）

## 决策记录

| ID | 决策 | 替代方案 | 理由 |
|---|---|---|---|
| D-001 | retrieval 阶段加 fast LLM 改写（C-B 方案） | C-A 直接拼接 history / C-C history-aware embedding model | C-A 噪声大不可控；C-C 重构成本极高 |
| D-002 | 改写后 query 仅用于 retrieval / grade / rewrite / web；generation 仍喂原 question | 全部环节统一用改写后 query | LLM 看到用户原话 + 完整 history，体感自然；图谱也应记录用户实际所问 |
| D-003 | 触发条件：history 非空 AND（≤12 字 OR 含代词 OR 含元词） | 每次都改写 / 只看长度 | 平衡 cost 与召回率；改写不必要时无害（改写结果若 = 原句则不替换） |
| D-004 | 任何失败回落原 question | 抛错中断主流程 | 改写是 enhancement，主流程不应受影响 |
| D-005 | env 默认 on | 默认 off + 灰度 | 已实测有效（rerank top-1 0.027 → 0.472）；off 等价老行为，回滚成本零 |
| D-006 | 不区分 condense 用的 fast LLM 跟 ragPipeline 已有 fast LLM 调用 | 单独配 model | 复用 `getLlmFastModel()` 简化配置 |

## 接口契约（freeze 项）

详见 `specs/condense-question-spec.md` / `specs/ragpipeline-integration-spec.md`。

下游消费者（合并后才能开始消费）：
- 未来前端在 SSE 消费层显示改写痕迹：消费 `rag_step` 事件 icon=`🪄` 的 label
- 未来如果做 condense 跨 session cache：复用 `condenseQuestion` 函数 + 包装一层 cache
- 未来 D-003 eval 集：用 `condenseQuestion` 直接调评估改写质量
