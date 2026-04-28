# Explore · RAG Follow-up Question Condensation（档 B 第 1 步设计草稿）

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Explore（不进主分支，仅作 Lock 阶段输入）
> 倒推说明：本文档由 2026-04-28 实地调优后回补，用于支撑同日 OpenSpec lock。

## 背景

实地测试连续多轮对话场景出现 user-facing 痛点：

```
用户：道德经是谁写的
助手：《道德经》的作者是老子。
用户：你给我道德经第一章的内容
助手：道可道，非常道；名可名，非常名。无名，天地之始；有名，万物之母…… [5][6]
用户：那你把原文发我          ← 痛点
助手：抱歉，知识库里**暂时没有**与该问题直接相关的内容。
     （检索相关性最高仅 0.027，低于可用阈值 0.05）
```

代码定位（`apps/qa-service/src/services/ragPipeline.ts`）：

| 环节 | 是否使用 history | 备注 |
|---|---|---|
| `retrieveInitial(question, ...)` | ❌ | embedding 只用当前 turn 的 question |
| `coarseFilterByL0(question, ...)` | ❌ | L0 粗筛同上 |
| `gradeDocs(question, ...)` | ❌ | LLM grade 同上 |
| `rewriteQuestion(question, ...)` | ❌ | step_back / hyde 重写也只看 question |
| `generateAnswer(question, history, ...)` | ✅ | **唯一**用 history 的环节 |
| `recordCitations(question, ...)` | ❌ | 写图谱用原 question |

意味着 "那你把原文发我" 在 retrieval 阶段就是孤立的 7 个字 → embedding 跟"道德经"
毫无语义距离 → rerank top-1 = 0.027 → 命中 short-circuit `RAG_NO_LLM_THRESHOLD`
（默认 0.05）→ 直接吐兜底文案。

**根因：retrieval 没用对话历史**。这是经典的 follow-up question 问题。

## 设计候选 (3 选 1)

| 方案 | 描述 | 评估 |
|---|---|---|
| **C-A 拼接 history 到 query** | 把最近 N 轮 history 文本拼到当前 question 直接做 embedding | 简单但噪声大；助手长文本会污染 query embedding；不可控 |
| **C-B fast LLM 改写**（选中） | history 非空 + 短指代型问题时，调 fast LLM 改写成自洽独立问句，用改写后的 query 喂 retrieval | 改写质量可控、cost ~200ms、跟现有 step_back/hyde 风格一致 |
| **C-C history-aware embedding model** | 用支持 conversation context 的 embedding（如 InstructorXL） | 需要换索引和模型，重构成本极高 |

**结论**：本 change 走 C-B；改写后的 query **只用于 retrieval / grade / rewrite /
web search**，generateAnswer 和 recordCitations 仍喂用户原句 + 完整 history（让
LLM 看到真实输入，让图谱记录用户实际所说）。

## 触发条件设计

不能每次都改写（成本 + 误改写风险）。trigger 取并集：

1. `history.length > 0`（必要条件，无 history 改不出来）
2. **AND** 问题"看起来像 follow-up"（任一）：
   - 长度 ≤ 12 字符（"原文" / "继续" / "再说说"）
   - 含代词（它 / 这 / 那 / 这个 / 那个 / this / that 等）
   - 含元词（原文 / 解释 / 翻译 / 总结 / 继续 / 详细 等）

边界 case：
- "什么是道？"（5 字 + history 空）→ length ≤ 12 命中但 history 为空 → 不触发
- "道德经的作者"（6 字 + history 非空）→ length ≤ 12 命中 → 触发（即便不必要也无害，改写后大概率仍是同一句）
- "请告诉我世界上最长的河流"（非 follow-up，长 + 无信号词 + 任意 history）→ 不触发

## 改写后 query 的使用范围

| 环节 | 用 condensed | 用原 question | 理由 |
|---|---|---|---|
| `adaptiveTopK` | ✅ | | 按改写后 query 决定 K，更贴近真实检索意图 |
| `coarseFilterByL0` | ✅ | | L0 粗筛要看真实意图 |
| `retrieveInitial` | ✅ | | 核心目标 |
| `gradeDocs` | ✅ | | 让 LLM 按改写后语义判 |
| `rewriteQuestion` (step_back/hyde) | ✅ | | step_back 之上再 step_back 才合理 |
| `webSearch` | ✅ | | "把原文发我" web 上等同噪声 |
| `generateAnswer` | | ✅ | LLM 看到用户原话 + 完整 history，体感自然 |
| `recordCitations` | | ✅ | 图谱记录用户实际所问 |
| `isDataAdminQuestion` | | ✅ | 这条是 dataAdmin 早返回判断，不应受改写影响 |

## 失败回落

任何异常 / 改写结果异常 → 透明回落原 question，主流程不受阻：
- env 关 `RAG_CONDENSE_QUESTION_ENABLED=false`
- LLM 抛 / 超时
- 触发条件不满足
- LLM 返回空 / 与原句相同 / 超 200 字

## 风险

| 风险 | 缓解 |
|---|---|
| **+1 fast LLM 调用**（仅触发时） | fast model（默认 Qwen2.5-7B）+ maxTokens 80 + temp 0.2；典型 ~200-400ms；不触发时零成本 |
| **改写改错** → retrieval 走偏 | 改写结果 emit `🪄` rag_step 让用户可见；改写质量靠 prompt + 触发条件保守；最坏情况退化到老行为 |
| **隐私 / 长 history 泄漏** | 只取 `slice(-4)`，每条截断到 400 字符 |
| **触发条件太严**（漏救合法 follow-up） | 长度阈值 ≤12 + 代词 + 元词三档 OR；漏救只是少改写一次，retrieval 行为退化到老版本，无新风险 |
| **触发条件太松**（误触发） | 改写后若与原句相同则不替换；prompt 显式要求"已自洽则原样输出" |

## 与现有架构的契合

- 复用 `services/llm.ts` 的 `chatComplete`（无新依赖）
- 不动 `KnowledgeQaAgent` / `dispatchHandler` / 上层架构
- 跟 viking memory（`KnowledgeQaAgent` 内的 `recallMemory`）正交：viking 拼到
  history 头部 augment LLM context；condense 是把 history 改写成 query 给 retrieval

## Out of Scope（明确不做）

- **改写 cache**（同一 question + history hash → 复用上次改写）—— 性价比低
- **改写质量量化 eval** —— 等多文档 eval 集（D-003）一起做
- **跟 step_back/hyde 合并成一个 LLM 调用** —— 语义不同（step_back 是泛化、hyde 是
  假设答案、condense 是消歧）；强行合并 prompt 复杂度高、错误率高

## 后续路径

- 上 D-003 多文档 eval 集后量化改写命中率
- 评估是否需要 condense cache（跨 session 同一 follow-up）
