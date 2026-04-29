# Impl Plan · N-001 Notebook 接入档 B 意图分流

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Execute（B 工作流第 3 步）
> OpenSpec：`openspec/changes/notebook-intent-routing-integration/`
> Explore：`docs/superpowers/specs/notebook-intent-routing-integration/design.md`

## 已完成清单（task 编号对照 `openspec/changes/notebook-intent-routing-integration/tasks.md`）

| Task | 文件 | 改动要点 | spec 锚点 |
|---|---|---|---|
| BE-1 | `apps/qa-service/src/services/answerPrompts.ts` | 新增 `export type CitationStyle = 'inline' \| 'footnote'` | citation-style-spec.md |
| BE-2 | 同上 | `buildSystemPromptByIntent` 加第 4 可选参数 + `toFootnoteCitations` 内部函数（regex `\[(N\|\d+)\]` 替换 `[N]`/`[1]` → `[^N]`/`[^1]`，仅 prompt 段，不动 context 段） | citation-style-spec.md 全部 scenario |
| BE-3 | `apps/qa-service/src/services/ragPipeline.ts` | `RunRagOptions` 加 `citationStyle?: CitationStyle` | notebook-chat-integration-spec.md "RunRagOptions 扩展" |
| BE-4 | 同上 | `generateAnswer` 加第 8 可选参数 `citationStyle: CitationStyle = 'inline'`；调 `buildSystemPromptByIntent` 时透传 | 同 |
| BE-5 | 同上 | `runRagPipeline` 内调 `generateAnswer` 时透传 `opts.citationStyle` | 同 |
| BE-6 | （已锁）| `systemPromptOverride` 优先级保持（未改逻辑） | rag-intent-routing freeze |
| BE-7 | `apps/qa-service/src/services/notebookChat.ts` | 删除 `NOTEBOOK_SYSTEM_PROMPT` 常量（41 行） | notebook-chat-integration-spec.md "改动" |
| BE-8 | 同上 | `runRagPipeline` 调用：`systemPromptOverride: NOTEBOOK_SYSTEM_PROMPT` → `citationStyle: 'footnote'` | 同 |
| BE-9 | 同上 | 文件头注释更新（说明 N-001 改造）| — |
| BE-10 | `apps/qa-service/src/__tests__/answerPrompts.test.ts` | 新增 `describe('citationStyle (N-001)')`：8 用例覆盖 inline 等价 / footnote 替换 / context 保留 / inlineImageRule 不误伤 / 模式名保留 / language_op 关键约束 / 禁词 / 边界 | citation-style-spec.md 全部 scenario |
| BE-11 | `npx tsc --noEmit -p apps/qa-service` | exit 0 / no output | — |
| BE-12 | tsx smoke `/tmp/smoke_n001.ts` | 34 断言全过 | — |
| DOC-1 | `docs/superpowers/specs/notebook-intent-routing-integration/design.md` | 已写 | B-1 |
| DOC-2 | `openspec/changes/notebook-intent-routing-integration/{proposal,design,specs/*-spec,tasks}.md` | 5 文件 | B-2 |
| DOC-3 | 本文件 | 倒推 | B-3 |

## 待办（B-4 验证 · 用户在 macOS 跑）

| Task | 期望产物 | 谁做 |
|---|---|---|
| V-1 | `pnpm -C apps/qa-service test` 含新 N-001 case 全绿（answerPrompts 14 → 22+ 用例） | user |
| V-2 | 重启 qa-service + 在某 notebook（含道德经 source）chat："给他的原文的解释" → 期望 emit `🎭 → language_op` + 答案逐句白话 + `[^N]` 引用 + 末尾透明度声明 | user |
| V-3 | 跨 notebook 多 intent 实测：factual_lookup（LFTGATE swing clearance 数值）/ language_op（中文 notebook 总结）/ kb_meta（"我这本里有什么"，预期已知 limitation 走 short-circuit） | user |
| V-4 | env `B_HANDLER_ROUTING_ENABLED=false` 跑 V-2 → 回落 factual_lookup 但仍 footnote 引用（citationStyle 不受 B env 影响）| user |
| AR-* | 看板 Done + 归档移文件 + 通知下游（N-002 / N-005 可复用 `citationStyle: 'footnote'`）| user |

## 验证通过的判定

V-2 case "给他的原文的解释" 必须满足：

```
... rag_step ...
🎭 答案意图分类 → language_op（rule:meta+imperative 或 LLM 给的 reason）
... chatStream 启动 ...

【完整答案】
- 每句道德经原文配白话翻译
- 引用形式 [^1] [^2]（不是 [1] [2]）
- 末尾透明度声明 "以上仅就文档原文做..."
- 不包含 "知识库中没有相关内容" 拒答
- 前端 ChatPanel.tsx 引用高亮正常工作（regex /\[\^(\d+)\]/g 匹配）
```

## 风险与回滚预案

| 风险 | 触发条件 | 回滚 |
|---|---|---|
| LLM 不稳定输出 `[1]` 而非 `[^1]` | V-2 答案引用前端不高亮 | 加强 prompt（在模板里再次重申 `[^N]` 格式）；或 SSE token 流后置 string replace |
| context 段被误替换 | 答案里出现 `[^1] doc1.pdf` 这种异常 | 检查 `toFootnoteCitations` 的 idx 拆分逻辑 |
| 整套 N-001 不如 main | 任何 V-* 失败 | revert commit；citationStyle 是可选参数，调用方零适配 |
| KnowledgeQaAgent 路径回归（不传 citationStyle 时行为变化）| 全局 chat 答案样式不一致 | 单元测试已锁"默认 = inline"；revert 同上 |

## 与本 PR 其它 N-* 后续路径关联

- **N-002** 扩展 artifact 类型 → 用 `buildSystemPromptByIntent` + `citationStyle: 'footnote'`
- **N-005** artifact 接入意图分流 → 直接复用 N-001 接口扩展
- **D-002.2** kb_meta 路由 asset_catalog → V3D 同根因，notebook 内 kb_meta 也受益
