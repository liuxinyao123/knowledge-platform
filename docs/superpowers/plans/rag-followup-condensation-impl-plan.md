# Impl Plan · RAG Follow-up Condensation（档 B 第 3 步 · 实施计划倒推）

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Execute（B 工作流第 3 步）
> 倒推说明：本计划在代码已实施后回补，作为 OpenSpec change 与现有代码的映射表。
> OpenSpec：`openspec/changes/rag-followup-condensation/{proposal,design,specs/*-spec,tasks}.md`

## 已完成清单（task 编号对照 `openspec/changes/rag-followup-condensation/tasks.md`）

| Task | 文件 | 行/段落 | spec 锚点 |
|---|---|---|---|
| BE-1 ~ BE-7 | `apps/qa-service/src/services/condenseQuestion.ts` | 全文 130 行 | `condense-question-spec.md` 全部 scenario |
| BE-8 | `apps/qa-service/src/services/ragPipeline.ts` | imports 段（line ~21） | `ragpipeline-integration-spec.md` 模块边界 |
| BE-9 ~ BE-11 | `apps/qa-service/src/services/ragPipeline.ts` | `runRagPipeline` Step 0 ~ Step 5 | `ragpipeline-integration-spec.md` 全部 scenario |
| BE-12 | `apps/qa-service/.env.example` | "follow-up condensation" 段 | `proposal.md` Scope 4 |
| BE-13 | `apps/qa-service/src/__tests__/condenseQuestion.test.ts` | 17 用例 | `condense-question-spec.md` 全部 scenario |
| BE-14 | `npx tsc --noEmit -p apps/qa-service` | exit 0 / no output | — |
| BE-15 | tsx smoke `/tmp/smoke_condense.ts` + `/tmp/smoke_condense_llm.ts`（已清理）| 28 断言全过 | — |
| DOC-1 | `docs/superpowers/archive/rag-followup-condensation/design.md` | 全文 | B 工作流第 1 步 |
| DOC-2 | `openspec/changes/rag-followup-condensation/{proposal,design,specs/*-spec,tasks}.md` | 全部 5 文件 | B 工作流第 2 步 |
| DOC-3 | 本文件 | 全文 | B 工作流第 3 步 |

## 已验证（V-1 ~ V-3 实测通过）

| Task | 实际产物 |
|---|---|
| V-1 | `pnpm -C apps/qa-service test` 报告：condenseQuestion 17/17 通过 |
| V-2 | `bash scripts/test-ad-tuning.sh` case1a 输出： <br>`🪄 指代改写：「那你把原文发我」→「你把《道德经》第一章的内容原文发给我」` <br>`✨ Reranker 精排完成（前 5 分数：0.476 / 0.299 / 0.232 / 0.220 / 0.163）` <br>`💬 收到 74 段 content（已生成回答）` <br>**完整答案**：道可道，非常道；名可名，非常名。无名，天地之始；有名，万物之母…… [4][9] |
| V-3 | case2b "什么是道？"（空 history）：未出现 `🪄`（condense 不触发）；rerank top-1 = 0.94 命中；行为等价 main |

## 待办

| Task | 期望产物 | 谁做 |
|---|---|---|
| V-4 | 跨文档类型 manual 实测记录（≥3 类非古文文档 × 短指代型 follow-up）| user |
| AR-* | 看板状态切换 + 归档移文件 + 通知下游 | user |

## 风险与回滚预案

| 风险 | 触发条件 | 回滚动作 |
|---|---|---|
| condense 改写改错 → retrieval 走偏 | V-4 实测发现某类文档下改写质量差（如英文 follow-up） | 检查 `META_MARKERS` / `PRONOUN_MARKERS` 是否覆盖该语种；考虑加 LLM 改写 prompt 的 few-shot 例 |
| condense fast LLM 5xx 频繁 | `.dev-logs/qa-service.log` 出现频繁 `LLM API 502` | 不阻塞主流程（已 catch 回落原 question）；运维侧排查 fast model 容量 |
| condense 把"已自洽问题"误改写成偏义 | V-4 实测发现 | LLM prompt 已含"已自洽则原样输出"指令；若仍误改，加更严的"原样输出条件" |
| 整套行为不如 main | 任何 V-* 失败 | env `RAG_CONDENSE_QUESTION_ENABLED=false` + qa-service 重启 → 等价 main |

## 下一轮路径

按 `proposal.md` Out of Scope 段落：

1. **D-003 多文档 eval 集**（量化改写质量 + 改写后 retrieval 命中率）
2. condense cache（性价比待评估）
3. 跨语种 follow-up 改写（英文 / 日文）—— 看 V-4 实测结果决定是否要专门做
