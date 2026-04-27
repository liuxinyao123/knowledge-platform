# ADR 2026-04-23-24 · Bug Batch H · Notebook chat short-circuit 过拟合修复

## Context

用户在 notebook 里上传了 3 份工程文档（Bumper Integration BP / LFTGATE-3 / LFTGATE-32），问"根据资料给我产出测试要求"、"你能查出什么呢"，两次都被返回同一段兜底文案：

> 抱歉，知识库里**暂时没有**与该问题直接相关的内容。
> （检索相关性最高仅 0.017 / 0.013，低于可用阈值 0.05）

这是 D-007 `NO_LLM_THRESHOLD=0.05` 短路补丁（`2026-04-23-22-rag-relevance-hygiene-lock.md`）的过拟合副作用：

- D-007 本意：BUG-01 里 LLM 被全 OCR 乱码 context 毒化 → 两字截断；短路兜住
- 实际副作用：**notebook 等用户显式 scope 场景里，合成/meta 类查询天然 rerank 打低分**（chunk 里不会有一句话直接写"测试要求 = ..."，但 LLM 本来能从规格书里推导）；短路把这类合法合成查询也切了，notebook 看起来是个摆设

工作流：C `superpowers-feature-workflow`（一处 state 分支 + 两条单测，不产 OpenSpec）。

## Decision · D-008

### 修改点

`apps/qa-service/src/services/ragPipeline.ts` · 短路判定前加 scope 豁免：

```ts
const userScoped = (opts.assetIds?.length ?? 0) > 0
if (rerankerOn && userScoped && top1Score < noLlm) {
  emit({ type: 'rag_step', icon: 'ℹ️',
    label: `用户显式 scope（${opts.assetIds?.length} 个资产），跳过阈值短路，正常调 LLM。` })
}
if (rerankerOn && !userScoped && top1Score < noLlm) {
  // 原短路兜底块不动
}
```

逻辑：`opts.assetIds` 非空表示调用方（当前是 `notebookChat.ts`，未来可能有其他 scope 来源）已经锁定了检索范围 = 用户显式授权"用这些"。相关性判定交给用户，不再由阈值代劳。

### 保留的两层防护

1. **WARN（0.1 阈值）不动** —— `ragPipeline.ts:215` 仍然对 top-1 < 0.1 emit `⚠️ rag_step`；用户能看到"相关性低"的提示，自己判断是否重问
2. **chatStream 空流守护不动** —— `services/llm.ts::chatStream` 仍会在 yielded=0 时 throw；D-007 D3 层依然兜底 LLM 真空响应场景

被关的只是"强制用兜底文案覆盖 LLM"这一层，不是整个健康检查。

### 系统 prompt 的配合

`notebookChat.ts::NOTEBOOK_SYSTEM_PROMPT` 已经教过 LLM：

> 找不到信息就明确回复「知识库中没有相关内容」，不要编造、不要猜

所以当 3 份文档里真的没有相关答案时，LLM 自己会说"找不到"——这比硬写死的兜底文案更精准（能具体说"这 3 份 bumper/liftgate 文档里没提测试要求"而不是笼统的"暂时没有"）。

### 不选的方案

| 方案 | 为什么不选 |
|---|---|
| 按 intent 分阈值（`NO_LLM_THRESHOLD_NOTEBOOK=0.0` / `NO_LLM_THRESHOLD_GLOBAL=0.05`） | 双 env 增加运维心智负担；notebook 语义已经蕴含"用这些"，不需要单独阈值 |
| LLM 预分类 meta-query vs lookup-query | 多一次 LLM 调用，延迟 + 成本都涨；收益不对等 |
| 完全移除 D-007 短路 | BUG-01 的全库乱码场景依然需要兜底；不能整体回退 |
| `notebookChat.ts` 里 try/catch 后重试时移除 scope | 破坏"只用 notebook 内文档"的硬约束（`NOTEBOOK_SYSTEM_PROMPT` rule #1） |

## Tests

`apps/qa-service/src/__tests__/ragPipeline.shortCircuit.test.ts` 新增 2 条：

1. **`opts.assetIds 非空 + top-1 超低 → 仍调 chatStream`**：模拟 notebook 场景 assetIds=[101,102,103] + rerank top-1 = 0.017，断言 `chatStream` 被调用 1 次 + `rag_step` 出现"用户显式 scope"字样 + 兜底文案 `暂时没有` 不出现
2. **`opts.assetIds 空数组 → 视为全局，继续 short-circuit`**：边界 case，空数组 `[]` 应和 undefined 一样走全局短路分支

原 5 条 short-circuit 测试全部无改动，继续保障全局 `/api/qa/ask` 场景的 D-007 行为。

## 验证

### 编译
- `qa-service` `npx tsc --noEmit` → **EXIT=0，0 错误**
- `web` 本批未动前端，跳过

### 手测（用户本机）
用户需在 notebook 里复测一次：

1. 打开原来出问题的 notebook `[seed] permissions-v2 冒烟`
2. 再问一次"根据资料给我产出测试要求"
3. 期望：
   - 不再出现"抱歉，知识库里暂时没有"的兜底文案
   - Trace 里能看到 ℹ️ rag_step "用户显式 scope（3 个资产）…"
   - LLM 基于 3 份规格书做一次合成回答（可能短、可能承认"文档里没有测试要求但可以推导出..."，但不应该是兜底文案）
   - trace ⚠️ WARN 仍会出现（top-1 0.017 < 0.1），这个预期

## Follow-up / Scope Out

| 项 | 类型 | 去处 |
|---|---|---|
| /agent dispatch 的 knowledge_qa intent 是否也考虑"意图信号 = 用户限定了 source"豁免 | UX 扩展 | 下一轮 A/B；现在没用例不做过早抽象 |
| Hybrid search + reranker 关闭场景下的相关性判定 | 正确性 | 现有 `if (rerankerOn && ...)` 已兜住（reranker 关 → 不短路，原逻辑）；无需改 |
| 测试报告里另外几条 notebook chat UX（如 trace 里的相关性显示带 ⚠️ 但同时给出回答会不会让用户困惑） | UX 文案 | 下一批 C；可以加"相关性低，答案仅供参考"的 pill |
| D-007 ADR 里的 NO_LLM_THRESHOLD 默认值是否重审 | 阈值调优 | 现在 notebook 已豁免，全局 0.05 针对 BUG-01 场景仍合适，不动 |

## 归档
- 上游：D-007 `.superpowers-memory/decisions/2026-04-23-22-rag-relevance-hygiene-lock.md`
- 触发：浏览器回归补测（notebook chat 手验发现）
- 决策锚：本文件
