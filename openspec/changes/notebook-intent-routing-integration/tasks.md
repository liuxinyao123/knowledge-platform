# Tasks: N-001 Notebook 接入档 B 意图分流

> 工作流：B `superpowers-openspec-execution-workflow`
> 状态：B-2 OpenSpec Lock 完成；按要求"按 N-001 到 N-008 实现吧"，进 B-3 Execute

## 后端（apps/qa-service）

### 接口扩展
- [ ] BE-1：`services/answerPrompts.ts` —— 新增 `export type CitationStyle = 'inline' | 'footnote'`
- [ ] BE-2：`services/answerPrompts.ts` —— `buildSystemPromptByIntent` 加第 4 可选参数
      `citationStyle: CitationStyle = 'inline'`，footnote 模式拆 prompt/context 段、
      仅替换 prompt 段的 `[N]` → `[^N]`
- [ ] BE-3：`services/ragPipeline.ts` —— `RunRagOptions` 加可选字段 `citationStyle`
- [ ] BE-4：`services/ragPipeline.ts` —— `generateAnswer` 加第 8 可选参数 `citationStyle`，
      调 `buildSystemPromptByIntent` 时透传
- [ ] BE-5：`services/ragPipeline.ts` —— `runRagPipeline` 内调 `generateAnswer` 时透传
      `opts.citationStyle`
- [ ] BE-6：systemPromptOverride 优先级保持（spec 已锁；实现确保 override 时
      跳过意图分类 + 忽略 citationStyle）

### notebookChat 改造
- [ ] BE-7：`services/notebookChat.ts` —— 删除 `NOTEBOOK_SYSTEM_PROMPT` 常量
- [ ] BE-8：`services/notebookChat.ts` —— `runRagPipeline` 调用：
      `systemPromptOverride: NOTEBOOK_SYSTEM_PROMPT` → `citationStyle: 'footnote'`
- [ ] BE-9：清理 import（如果 NOTEBOOK_SYSTEM_PROMPT 已经是唯一 import 那行就一并删）

### 测试
- [ ] BE-10：`__tests__/answerPrompts.test.ts` 加 footnote 模式 6+ case：
      - 默认 inline 等价老行为（5 intent）
      - footnote prompt 段 [N]→[^N] 替换正确（5 intent）
      - footnote context 段 [N] 不替换（拆分隔离正确）
      - footnote inlineImageRule 中 ![alt](url) 不误伤
      - footnote 5 模板禁词检查
      - 显式传 'inline' = 默认行为
- [ ] BE-11：tsc clean
- [ ] BE-12：tsx smoke 验证 footnote 模式 prompt 输出（不依赖 vitest，沙箱可跑）

## 文档
- [x] DOC-1：`docs/superpowers/specs/notebook-intent-routing-integration/design.md` ✓
- [x] DOC-2：`openspec/changes/notebook-intent-routing-integration/{proposal,design,specs/*-spec,tasks}.md` ✓
- [ ] DOC-3：`docs/superpowers/plans/notebook-intent-routing-integration-impl-plan.md`
      （B-3 实施完成后倒推记录）

## 验证（B-4 前置）
- [ ] V-1：`pnpm -C apps/qa-service test` 通过 answerPrompts / ragPipeline /
      ragPipeline.shortCircuit / answerIntent 全部套件（零回归）+ 新加 footnote case
- [ ] V-2：在某 notebook 内（含道德经 source）跑 chat："给他的原文的解释"
      期望：emit `🎭 → language_op` + 答案逐句白话 + `[^N]` 引用 + 末尾透明度声明
      （而**不**是拒答 "知识库中没有相关内容"）
- [ ] V-3：跨 notebook 实测多 intent：
      - factual_lookup：在某 LFTGATE notebook 问"swing clearance 是多少"
      - language_op：在某中文 notebook 问"总结上面这段"
      - kb_meta：在某 notebook 问"我这本里有什么资料"（预期已知 limitation 走 short-circuit）
- [ ] V-4：env `B_HANDLER_ROUTING_ENABLED=false` 跑 V-2 case，确认回落到
      factual_lookup（=老严格 RAG），但**仍是 footnote 引用**（citationStyle 不受 B env 影响）

## Archive（B-4 验证通过后）
- [ ] AR-1：`docs/superpowers/specs/notebook-intent-routing-integration/` →
      `docs/superpowers/archive/notebook-intent-routing-integration/`
- [ ] AR-2：看板状态 Done
- [ ] AR-3：合并 PR；OpenSpec freeze 生效
- [ ] AR-4：通知下游：N-002 / N-005 可以复用 `citationStyle: 'footnote'` 参数
