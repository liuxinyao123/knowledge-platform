# Proposal: Notebook 接入档 B 意图分流（N-001）

## Problem

`apps/qa-service/src/services/notebookChat.ts` 调 `runRagPipeline` 时传
`systemPromptOverride: NOTEBOOK_SYSTEM_PROMPT`。按 rag-intent-routing 的
`handler-routing-spec.md`：

> systemPromptOverride 仍然优先：传入时**跳过 classifier**（向后兼容）。

意味着 notebook 内对话**不走档 B 5 类意图分流**，仍用一份 monolithic
NOTEBOOK_SYSTEM_PROMPT（含 mm/COF/0.3+0.7 三个工业制造 hardcoded 示例 + 严格
"找不到说没有"规则）。

复现：在某 notebook（含道德经 source）内问"给他的原文的解释"——按 NOTEBOOK_
SYSTEM_PROMPT 拒答 "知识库中没有相关内容"。**跟刚修好的全局 chat 行为不一致**——
全局 chat 走 language_op handler 输出逐句白话。

A condense 和 C adaptiveTopK 因为在 retrieval 阶段已自动对 notebook 生效；
档 B 因为是 prompt 阶段被 override 跳过，没对 notebook 生效。

## 关键约束 · 引用样式不兼容

- 全局 chat：`[1] [2] [1][2]` (rag-intent-routing 5 个模板都用)
- Notebook ChatPanel.tsx:304 引用 regex：`/\[\^(\d+)\]/g` —— 只识别 **`[^N]`**

直接让 notebook 走档 B 模板会导致前端引用解析失败。N-001 必须解决引用样式
兼容。

## Scope（本 Change）

1. **`services/answerPrompts.ts`** 加可选 `citationStyle: 'inline' | 'footnote'`
   参数（默认 `inline` = 老行为）；footnote 模式下 5 个模板里所有 `[N]` 字面
   替换为 `[^N]`
2. **`services/ragPipeline.ts`** `generateAnswer` 加可选 `citationStyle` 参数；
   `RunRagOptions` 加 `citationStyle` 字段并在 `runRagPipeline` 透传给
   `generateAnswer`
3. **`services/notebookChat.ts`**：
   - 删除 `NOTEBOOK_SYSTEM_PROMPT` 常量（不再需要 monolithic prompt）
   - 把 `systemPromptOverride: NOTEBOOK_SYSTEM_PROMPT` 改为
     `citationStyle: 'footnote'`
4. **单元测试**：`answerPrompts.test.ts` 加 footnote 模式 case；`ragPipeline`
   现有测试零改动（默认 citationStyle=inline）
5. **不动**：notebook 端点 / 表 schema / SSE 事件类型 / ChatPanel regex /
   systemPromptOverride 口子（其它调用方将来仍可用）

## Out of Scope（后续 Change）

- per-notebook 自定 prompt 套件 → N-006 templates
- per-tenant citationStyle 配置 → D-004 prompt 数据化候选
- 完全删 `systemPromptOverride` → 保留口子，未来其它路径可能用
- artifact 生成器（briefing / faq）也接入档 B → N-005

## 决策记录

| ID | 决策 | 替代方案 | 理由 |
|---|---|---|---|
| D-001 | C-B 方案：扩 buildSystemPromptByIntent 加 citationStyle 参数 | C-A SSE 流后置 string replace / C-C notebookChat 自分类 | C-A 流式切片风险高、replace 藏在中间层；C-C 重复档 B 逻辑维护成本高；C-B 引用样式提升为一等参数最干净 |
| D-002 | citationStyle 默认 'inline'（=老行为）| 默认 'footnote' | 向后兼容已 freeze 的 rag-intent-routing 契约，调用方零适配 |
| D-003 | footnote 模式用字符串 replace（`[N]` → `[^N]`） | 模板里写两套 | 只差一字符，replace 简洁；测试容易覆盖 |
| D-004 | 保留 `systemPromptOverride` 不删 | 完全删 | 给其它特殊路径留口子；本 PR 仅 notebook 不再用 |
| D-005 | inline image 规则 6 不受影响 | 也改 | image markdown `![alt](url)` 不含 `[N]` 字符串，无关 |

## 接口契约（freeze 项）

详见 `specs/citation-style-spec.md` + `specs/notebook-chat-integration-spec.md`。

下游消费者（合并后才能开始消费）：
- N-002 / N-005 artifact 接入意图分流时复用 `citationStyle` 参数
- 未来 D-004 prompt 数据化时把 inline / footnote 抽到配置文件
