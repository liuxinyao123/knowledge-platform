# Tasks: N-005 Notebook Artifact 接入档 B 意图分流

> 工作流：B `superpowers-openspec-execution-workflow`
> 状态：B-2 OpenSpec Lock 完成；进 B-3 Execute

## 后端（apps/qa-service）

### 注册表填值
- [ ] BE-1：`services/artifactGenerator.ts` ARTIFACT_REGISTRY 给 8 个 spec 填 `intent`
      - briefing / faq / mindmap / outline / timeline / slides → 'language_op'
      - comparison_matrix → 'multi_doc_compare'
      - glossary → 'factual_lookup'

### env + 路由
- [ ] BE-2：新增 `export function isArtifactIntentRoutingEnabled(): boolean`
      （默认 on，false/0/off/no 关闭）
- [ ] BE-3：`executeArtifact` 加双路径分支：
      - 计算 `useIntentRouting = isArtifactIntentRoutingEnabled() && !!spec.intent`
      - 走档 B：system = `buildSystemPromptByIntent(spec.intent, ctx, '', 'footnote')`；
        user = `请基于上面的文档生成「${spec.label}」，按以下格式：\n\n${promptHead}`
      - 走老：system = `${promptHead}\n\n# 文档：\n${ctx}`；user = `请生成${spec.label}。`
- [ ] BE-4：`meta.intent_used` 写入：useIntentRouting 时 = spec.intent，否则 null
- [ ] BE-5：`import { buildSystemPromptByIntent } from './answerPrompts.ts'`

### 测试
- [ ] BE-6：`__tests__/artifactRoutingDispatch.test.ts`（新建）
      - mock chatComplete + pgPool
      - 8 个 kind × 2 env 状态 = 16 case
      - 验证 system/user message 形态 + meta.intent_used 字段
- [ ] BE-7：`__tests__/artifactRegistry.test.ts` 加 8 个 spec.intent 字段断言
      （把 N-002 "intent 全 undefined" 那段反过来）
- [ ] BE-8：tsc clean + tsx smoke

### 配置
- [ ] BE-9：`apps/qa-service/.env.example` 加 `B_ARTIFACT_INTENT_ROUTING_ENABLED=true`
      段落 + 中文说明

## 文档
- [x] DOC-1：`docs/superpowers/specs/notebook-artifact-intent-routing/design.md` ✓
- [x] DOC-2：`openspec/changes/notebook-artifact-intent-routing/{proposal,specs/*-spec,tasks}.md` ✓
- [ ] DOC-3：`docs/superpowers/plans/notebook-artifact-intent-routing-impl-plan.md`

## 验证（B-4 前置）
- [ ] V-1：`pnpm -C apps/qa-service test` artifactRoutingDispatch 16 case 全过 +
      artifactRegistry intent 断言全过 + 现有套件零回归
- [ ] V-2：在某 notebook 内（≥ 1 source）UI 触发 4 类 artifact：briefing /
      comparison_matrix（单 source 应输出"无法生成对比矩阵"）/ glossary / slides
- [ ] V-3：检查 meta.intent_used 字段：env on 时 4 类对应 'language_op' /
      'multi_doc_compare' / 'factual_lookup' / 'language_op'
- [ ] V-4：env `B_ARTIFACT_INTENT_ROUTING_ENABLED=false` 重启 + 重跑 V-2，
      meta.intent_used 全 null + content 跟 N-002 老行为一致
- [ ] V-5：跨文档类型实测：英文 SOP notebook 触发 briefing → 应基于英文文档
      做总结 + footnote 引用 + 透明度声明（language_op 模板的特征）

## Archive（B-4 验证通过后）
- [ ] AR-1：`docs/superpowers/specs/notebook-artifact-intent-routing/` → `archive/`
- [ ] AR-2：看板 Done
- [ ] AR-3：合并 PR；intent 映射 freeze
- [ ] AR-4：通知下游：N-006 Notebook templates 可消费 ARTIFACT_REGISTRY[kind].intent
