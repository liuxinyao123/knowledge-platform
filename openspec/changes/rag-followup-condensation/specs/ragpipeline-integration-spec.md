# Spec: ragPipeline.runRagPipeline 接入 condenseQuestion

## 接入点

`apps/qa-service/src/services/ragPipeline.ts` 中 `runRagPipeline` 函数体内，
位于：

- `signal.aborted` 早返回之后
- `adaptiveTopK` 调用之前

`runRagPipeline` 对外签名 **不变**。

---

## 行为契约

### Scenario: 改写后的 query 用于 retrieval 路径

- Given `condenseQuestion(question, history, emit)` 返回 `'请提供《道德经》第一章的原文'`
- When `runRagPipeline` 执行
- Then `adaptiveTopK` 入参 = 改写后的 query
- And `coarseFilterByL0` 入参 = 改写后的 query
- And `retrieveInitial` 入参 = 改写后的 query
- And `gradeDocs` 入参 = 改写后的 query
- And `rewriteQuestion`（Step 3 step_back/hyde）入参 = 改写后的 query
- And `webSearch` 入参 = 改写后的 query

### Scenario: 原 question 用于 generation 路径

- Given 同上
- When `runRagPipeline` 执行
- Then `generateAnswer` 入参 question = 原 question（用户原话）
- And `recordCitations` 入参 question = 原 question
- And `isDataAdminQuestion` 早返回判断用 = 原 question

### Scenario: 改写不触发时所有环节用原 question

- Given `condenseQuestion` 返回原 question（env 关 / history 空 / 触发不命中 / LLM 失败）
- When `runRagPipeline` 执行
- Then 上述全部环节都用同一个原 question 入参（行为等价 main 老版本）

### Scenario: emit 顺序 —— condense rag_step 早于 retrieval

- Given condense 触发并成功改写
- When `runRagPipeline` 执行
- Then emit 顺序：
  1. `🪄 指代改写：「<原>」→「<改写后>」`
  2. `⚙️ 自适应 top-K = N（<reason>）`（如果 dynK ≠ TOP_K）
  3. `🔍 正在检索知识库...`
  4. ...

### Scenario: signal abort 在 condense 之后立即生效

- Given AbortSignal 在 `condenseQuestion` 返回后被 abort
- When `runRagPipeline` 检查 `signal.aborted`
- Then 立即 return，不进入 adaptiveTopK / retrieval

### Scenario: condense 调用本身不被 signal 打断

- 当前实现说明：`condenseQuestion` 内部用自己的 1.5s 不到的 timeout，
  不接收 outer signal；这是 D-007 候选项（如需可后续引入）。
  本 spec 阶段不约束这个行为。

---

## 与其它环节的零交互保证

### Scenario: `KnowledgeQaAgent.run` viking memory 路径不动

- Given `VIKING_ENABLED=1` 且 `ctx.session_id` 非空
- When `KnowledgeQaAgent.run` 调 `runRagPipeline(ctx.question, augmentedHistory, ...)`
- Then condense 看到的是 `ctx.question`（用户原话）+ `augmentedHistory`（含 viking
  recall context 块）
- And condense 改写时会把 viking context 也作为 history 输入考虑（这是 expected behavior）

### Scenario: `dispatchHandler` history 限制不变

- Given `validateHistory` 限 `MAX_HISTORY_LEN=40` / 单条 `MAX_HISTORY_CHAR=8000`
- And condense 内部再取 `slice(-4)` 截断
- Then 两层截断各管各：dispatch 层防客户端攻击；condense 层控成本

---

## 测试覆盖

- 单元测试：`__tests__/condenseQuestion.test.ts`（17 用例）
- ragPipeline 现有测试（`ragPipeline.test.ts` / `ragPipeline.shortCircuit.test.ts`）
  全部用 `history=[]` 调 `runRagPipeline` → condense 不触发 → 行为等价 main → 零回归
- smoke 验证：tsx 直跑 28 断言（`looksLikeFollowUp` / `isCondenseEnabled` /
  无 LLM 路径 / 引号清理 / 异常 / 空 / 等于原句 / 超长 / env=false）

---

## 回滚

- env `RAG_CONDENSE_QUESTION_ENABLED=false` → 进程内立即回落（condense 跳过 LLM 调用）
- revert 本 change 的 commit → `runRagPipeline` 签名不变 → 调用方零适配
