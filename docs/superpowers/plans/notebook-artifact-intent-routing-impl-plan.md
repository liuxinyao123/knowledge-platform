# Impl Plan · N-005 Notebook Artifact 接入档 B 意图分流

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Execute（B-3）
> OpenSpec：`openspec/changes/notebook-artifact-intent-routing/`
> Explore：`docs/superpowers/specs/notebook-artifact-intent-routing/design.md`

## 已完成清单

| Task | 文件 | 改动 |
|---|---|---|
| BE-1 | `services/artifactGenerator.ts` ARTIFACT_REGISTRY | 8 个 spec 填 intent：briefing/faq/mindmap/outline/timeline/slides → language_op；comparison_matrix → multi_doc_compare；glossary → factual_lookup |
| BE-2 | 同上 | 新增 `export function isArtifactIntentRoutingEnabled()`（默认 on，false/0/off/no 关）|
| BE-3 | `executeArtifact` | 双路径：`useIntentRouting && spec.intent` 时 system = `buildSystemPromptByIntent(intent, ctx, '', 'footnote')` + user = `请基于上面的文档生成「${label}」，按以下格式：\n\n${promptHead}`；否则走 N-002 老路径 |
| BE-4 | 同上 | meta 加 `intent_used` 字段（useIntentRouting → spec.intent；否则 null）|
| BE-5 | 同上 | `import { buildSystemPromptByIntent } from './answerPrompts.ts'` |
| BE-7 | `__tests__/artifactRegistry.test.ts` | 把 N-002 "intent 全 undefined" 那段反过来：8 个 spec.intent 填值正确 + 排除 kb_meta/out_of_scope |
| BE-8 | tsc clean / tsx smoke 20/20 | 8 intent 映射 + env 开关 4 case |
| BE-9 | `apps/qa-service/.env.example` | 加 `B_ARTIFACT_INTENT_ROUTING_ENABLED=true` 段落 + 中文说明 |
| DOC-1/2 | Explore + OpenSpec | B-1 / B-2 |
| DOC-3 | 本文件 | B-3 |

## 待办（B-4 验证 · 用户在 macOS 跑）

| Task | 期望产物 | 谁做 |
|---|---|---|
| BE-6 | `__tests__/artifactRoutingDispatch.test.ts`（新建，16 case，mock chatComplete+pgPool 验证 system/user/maxTokens/meta.intent_used）—— **沙箱跑不动 vitest，留给 user**| user |
| V-1 | `pnpm -C apps/qa-service test` artifactRegistry 22+ assertion 全过 + 现有套件零回归 | user |
| V-2 | UI 在 notebook 内触发 4 类 artifact（briefing / comparison_matrix / glossary / slides）| user |
| V-3 | 检查 meta.intent_used 字段：4 类对应 'language_op' / 'multi_doc_compare' / 'factual_lookup' / 'language_op' | user |
| V-4 | env `B_ARTIFACT_INTENT_ROUTING_ENABLED=false` 跑 V-2，meta.intent_used 全 null + content 跟 N-002 老行为一致 | user |
| V-5 | 跨文档实测：英文 SOP notebook 触发 briefing → 应基于英文做总结 + footnote + 透明度声明 | user |
| AR-* | specs → archive；看板 Done | user |

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| 档 B 通用规则跟 artifact 格式约束在 LLM 那"打架" | user message 加显式提示 "按以下格式输出 markdown 文档"；V-2/V-5 实测确认 |
| 单 source notebook 触发 comparison_matrix → 走 multi_doc_compare 仍能输出"无法生成对比矩阵" | spec.promptTemplate 已含降级提示；V-2 实测确认 |
| glossary 走 factual_lookup 太严 → 拒答 | spec.promptTemplate 已写"文档只用了缩写但没解释的词，定义写'文档未给出明确定义'+[^N]"对齐 |
| 整套不如 N-002 | env `B_ARTIFACT_INTENT_ROUTING_ENABLED=false` 立即回退 |

## 与下游 N-* 的关系

- **N-003** sources 变更监听：可消费 `intent_used` 字段决定是否需要重生成
- **N-006** Notebook templates：直接复用 ARTIFACT_REGISTRY[kind].intent 推断模板套件的 prompt 风格
