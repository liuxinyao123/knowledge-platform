# Tasks: RAG Follow-up Question Condensation

> 倒推说明：本 tasks.md 在代码已实施后倒推记录；所有 ✅ 任务的实际产物都已存在仓库
> （详见 `docs/superpowers/plans/rag-followup-condensation-impl-plan.md`）。
> Archive 阶段（B-4）等用户实测验证通过后再做。

## 后端（apps/qa-service）

### 类型与接口
- [x] BE-1：新建 `src/services/condenseQuestion.ts` —— `looksLikeFollowUp` /
      `isCondenseEnabled` / `condenseQuestion` / 内部常量 `PRONOUN_MARKERS` /
      `META_MARKERS` / `FOLLOWUP_LEN_THRESHOLD=12` / `HISTORY_TAKE=4` /
      `HISTORY_PER_MSG_CHAR_CAP=400` / `REWRITTEN_MAX_CHAR=200`
- [x] BE-2：`condenseQuestion` 主流程：env 关 / history 空 / `looksLikeFollowUp`
      不命中 → 立即回落原句（不调 LLM）
- [x] BE-3：触发时调 `chatComplete` (fast model + maxTokens 80 + temperature 0.2)
- [x] BE-4：输出清理：剥前缀 "改写后：" / "独立问句：" + 剥行首破折号 + 剥首尾引号
- [x] BE-5：清理后空 / 超 200 字 / 等于原句 → 不替换 + 不 emit
- [x] BE-6：成功改写且 `cleaned !== question.trim()` → emit `{ rag_step, 🪄,
      '指代改写：「<原>」→「<改写后>」' }`
- [x] BE-7：LLM 异常 catch → 静默回落原句（不抛、不 emit）

### ragPipeline 接入
- [x] BE-8：`services/ragPipeline.ts` import `condenseQuestion`
- [x] BE-9：`runRagPipeline` 在 `signal.aborted` 早返回之后、`adaptiveTopK` 之前
      计算 `retrievalQuestion = await condenseQuestion(question, history, emit)`
- [x] BE-10：替换 retrieval 路径用 `retrievalQuestion`：`adaptiveTopK` /
      `coarseFilterByL0` / `retrieveInitial` / `gradeDocs` /
      `rewriteQuestion` / `webSearch`
- [x] BE-11：generation / 图谱 / 早返回判断保留原 `question`：`generateAnswer` /
      `recordCitations` / `isDataAdminQuestion` / `runDataAdminPipeline`

### 配置
- [x] BE-12：`apps/qa-service/.env.example` 加 `RAG_CONDENSE_QUESTION_ENABLED=true`
      段落，含中文说明 + 默认值 + 关闭值

### 测试
- [x] BE-13：`src/__tests__/condenseQuestion.test.ts` —— 17 vitest 用例覆盖：
      `looksLikeFollowUp` 6 case / `isCondenseEnabled` env 4 case /
      `condenseQuestion` 主行为 11 case（env 关 / history 空 / 不触发 / 触发成功
      改写 + emit / LLM 异常 / 返回空 / 等于原句 / 超长 / 引号清理 / prompt 内容）
- [x] BE-14：`tsc --noEmit` 干净
- [x] BE-15：tsx smoke：28 断言全过（无 LLM 路径 14 + LLM 路径 14）

## 文档
- [x] DOC-1：`docs/superpowers/specs/rag-followup-condensation/design.md` ——
      Explore 阶段设计草稿（B 工作流第 1 步产物）
- [x] DOC-2：`openspec/changes/rag-followup-condensation/{proposal,design,specs/*-spec,tasks}.md`
      —— OpenSpec Lock（B 工作流第 2 步产物）
- [x] DOC-3：`docs/superpowers/plans/rag-followup-condensation-impl-plan.md` ——
      实施计划倒推（B 工作流第 3 步产物）

## 验证（B 工作流第 4 步前置）
- [x] V-1：`pnpm -C apps/qa-service test` condenseQuestion 17/17 通过
- [x] V-2：实测 `bash scripts/test-ad-tuning.sh` case1a "那你把原文发我"：
      - emit `🪄 指代改写：「那你把原文发我」→「你把《道德经》第一章的内容原文发给我」`
      - rerank top-1 = 0.472（vs 改写前 0.027）
      - 不再触发 short-circuit，LLM 正常返回原文
- [x] V-3：实测 case2b "什么是道？"（空 history）：不触发 condense（无 🪄），无回归
- [x] V-4：跨文档实测（与 rag-intent-routing 同 PR 联跑）：
      - V3B 英→中：condense 改写"把上面这段翻译成中文"到原英文问句（丢失"翻译"
        指令）—— 已知 limitation：condense 对元指令型 follow-up 改写质量待提升；
        本 PR 通过规则前置（isObviousLanguageOp）绕过了下游意图分类的负面影响
      - V3B' 中→英：condense 把"translate the above"改写成"知识中台的核心模块
        有哪些需要翻译成英文？" → retrieval 命中 + 意图分类正确 ✓
      - V3B'' 总结今日头条（无 history）：不触发 condense ✓
      - case2a 回归：condense 改写质量好，意图分类正确 ✓

## Archive（B 工作流第 4 步 · 验证通过后）
- [ ] AR-1：把 `docs/superpowers/specs/rag-followup-condensation/` 移到
      `docs/superpowers/archive/rag-followup-condensation/`
- [ ] AR-2：在看板把本 change 状态标 Done
- [ ] AR-3：合并 PR 到 main，OpenSpec 契约 freeze 生效
- [ ] AR-4：通知下游（`condenseQuestion` 函数 + `RAG_CONDENSE_QUESTION_ENABLED`
      env 可消费）
