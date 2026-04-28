# Impl Plan · RAG Intent Routing（档 B 第 3 步 · 实施计划倒推）

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Execute（B 工作流第 3 步）
> 倒推说明：本计划在代码已实施后回补，作为 OpenSpec change 与现有代码的映射
> 表，便于 review 时核对每条 spec 落到哪个文件、对应哪些测试。
> 与 OpenSpec：`openspec/changes/rag-intent-routing/{proposal,design,specs/*-spec,tasks}.md`

## 已完成清单（task 编号对照 `openspec/changes/rag-intent-routing/tasks.md`）

| Task | 文件 | 行/段落 | spec 锚点 |
|---|---|---|---|
| BE-1 ~ BE-3 | `apps/qa-service/src/services/answerIntent.ts` | 全文 152 行 | `answer-intent-spec.md` 全部 scenario |
| BE-4 ~ BE-11 | `apps/qa-service/src/services/answerPrompts.ts` | 全文 116 行 | `answer-prompts-spec.md` 全部 scenario |
| BE-12 | `apps/qa-service/src/services/ragPipeline.ts` | imports 段（~21-22 行） | `handler-routing-spec.md` 模块边界 |
| BE-13 ~ BE-16 | `apps/qa-service/src/services/ragPipeline.ts` | `generateAnswer` 函数体内 hasWeb 分支 | `handler-routing-spec.md` 各 scenario |
| BE-17 ~ BE-18 | `apps/qa-service/src/services/ragPipeline.ts` | 删除原 `defaultSystem` 常量 + 旧示例 1-3 + 旧"作答步骤"段 + 上一版 D 加的"语言层例外" | `proposal.md` D-005 / D-006 |
| BE-19 | `apps/qa-service/.env.example` | "答案意图分流（ADR-46 D-002）" 段 | `proposal.md` Scope 1 |
| BE-20 | `apps/qa-service/src/__tests__/answerIntent.test.ts` | 17 用例 | `answer-intent-spec.md` 全部 scenario |
| BE-21 | `apps/qa-service/src/__tests__/answerPrompts.test.ts` | 7 用例 | `answer-prompts-spec.md` 全部 scenario |
| BE-22 | `npx tsc --noEmit -p apps/qa-service` | exit 0 / no output | — |
| BE-23 | tsx smoke `/tmp/smoke_b.ts`（一次性，已清理） | 26 / 26 pass | — |
| DOC-1 | `.superpowers-memory/decisions/2026-04-28-46-rag-intent-routing.md` | 全文 | 母 ADR |
| DOC-2 | `docs/superpowers/archive/rag-intent-routing/design.md` | 全文 | B 工作流第 1 步 |
| DOC-3 | `openspec/changes/rag-intent-routing/{proposal,design,specs/*-spec,tasks}.md` | 全部 7 文件 | B 工作流第 2 步 |
| DOC-4 | 本文件 | 全文 | B 工作流第 3 步 |

## V-1 / V-2 / V-3 / V-4 全部通过 ✅

| Task | 实际产物 | 状态 |
|---|---|---|
| V-1 | `pnpm -C apps/qa-service test` 79 用例全绿（condense 17 / answerIntent 24 / answerPrompts 7 / adaptiveTopK 17 / ragPipeline 14） | ✅ |
| V-2 | case1a/2a/2b 全部 emit `🎭 → <intent>`，case2a 输出逐句白话 + 透明度声明 | ✅ |
| V-3 | 跨文档实测：中文产品（V3A 总结）/ 英文 SOP（V3B 翻译）/ 古文（case2a）/ 文档外（V3E）全部正确分流 | ✅ |
| V-4 | env off 对照：case1a 回到 short-circuit 兜底，case2a 回到 LLM 拒答，三 case 都无 `🪄`/`🎭` | ✅ 回滚通道有效 |

### V-3 已知 limitation（接受 + 移到 ADR-46 后续路径）

| Case | 现象 | 根因 | 后续路径 |
|---|---|---|---|
| V3C "什么是 over slam" | factual_lookup 但拒答（top-1=0.94 命中但 LLM 说没有）| chunks 含术语但可能没解释；factual_lookup "找不到说没有"是诚实表现 | 接受为合理行为；如要改进 → D-002.3 召回策略优化 |
| V3D "库里有哪些汽车资料" | short-circuit 兜底（top-1=0.028）| kb_meta 类问题天生召回弱，short-circuit 在意图分类前 | **必须 D-002.2** 路由到 asset_catalog API 才能根治 |

### V-3 期间的 prompt patch（同 PR 内）

| 实测 | 修复 |
|---|---|
| V-2 case2a 误判 factual_lookup | classifier prompt 加"动作动词+meta 词"强判规则 + 修 emit 三元 bug |
| V-3 V3B 顶层误判 metadata_ops | `agent/intentClassifier.ts` SYSTEM_PROMPT 明确 metadata_ops 仅限元数据 CRUD |
| V-3 V3B 重测仍误判 factual_lookup | **isObviousLanguageOp 规则前置**：含 meta 动词 + 祈使/指代/短句 → 直接强制 language_op，跳过 LLM 概率执行 + 加 QUERY_STARTERS 排除避免 "我想了解 X" 误触发 |

## 验证通过的判定标准

V-2 的 case2a "给他的原文的解释" 必须满足：

```
... 其它 rag_step ...
🎭 答案意图分类 → language_op（<reason>）
... chatStream 启动 ...
💬 收到 ≥ 50 段 content（已生成回答）

【完整答案】
- 每句道德经原文配白话翻译（"道可道，非常道——可以用言语说出的道..."）
- 末尾透明度声明（"以上仅就文档原文做白话翻译，未引入外部注疏"）
- 不包含 "知识库中没有具体解释内容" / "无法提供解释" 等拒答措辞
```

V-3 跨文档类型 manual 实测建议矩阵（用户填入实际数据）：

| 文档类型 | 问题 | 期望 intent | 期望行为 | 实际 |
|---|---|---|---|---|
| 技术 SOP | 这份 SOP 第 3 节的核心步骤是什么 | factual_lookup | 提取步骤 verbatim + [N] | _ |
| 技术 SOP | 总结一下这份 SOP 的关键点 | language_op | 提炼要点 + [N] + 透明度声明 | _ |
| 技术 SOP | 库里有没有 SOP 类的文档 | kb_meta | 列 asset_name | _ |
| 合同 | 合同生效日期 | factual_lookup | 日期 verbatim | _ |
| 合同 | 把这份合同的关键条款翻译成英文 | language_op | 逐条英译 + 透明度声明 | _ |
| 英文 paper | What is the main contribution of this paper | factual_lookup | 摘要原文片段 + [N] | _ |
| 英文 paper | 把这段 abstract 翻译成中文 | language_op | 中译 + 透明度声明 | _ |

任何一条出现"知识库中没有相关内容" 类拒答（且文档里实际有原文素材）→ 视为 V-3 失败 → 回到代码侧定位。

## 风险与回滚预案

| 风险 | 触发条件 | 回滚动作 |
|---|---|---|
| classifier 把 language_op 误判为 factual_lookup → 仍拒答 | V-2 case2a 输出 `🎭 → factual_lookup` 而非 language_op | 检查 classifier prompt 边界例子；考虑增加 fewer-shot example 或调高 temperature 范围 |
| factual_lookup prompt 过严导致 verbatim 回归 | V-3 数值题答案出现"约"/"大约"等模糊词 | 检查 factual_lookup 模板是否漏写"禁止模糊措辞" |
| classifier 总是 fallback（never reaches LLM） | V-2 输出全部没有 `🎭` 行 | 检查 env / LLM key / fast model 配置；看 `.dev-logs/qa-service.log` |
| 整套行为不如 main | 任何 V-* 失败 | env `B_HANDLER_ROUTING_ENABLED=false` + qa-service 重启 → 等价 factual_lookup → 等价 main 严格 RAG |

## 下一轮路径

按 `proposal.md` Out of Scope 段落执行（独立 PR / 独立 OpenSpec change）：

1. **D-003 多文档类型 eval 集**（D-002.1 / D-002.2 prerequisite）
2. **D-002.1** language_op 走 function tool（确定性 translate/summarize handler）
3. **D-002.2** kb_meta 路由到 asset_catalog API
4. **D-004（可选）** prompt 数据化
