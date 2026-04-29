# Spec: D-003 eval runner

## 文件：scripts/eval-multidoc.mjs + scripts/eval-multidoc-lib.mjs

### 公开 CLI

```bash
node scripts/eval-multidoc.mjs [jsonl-path] [flags]
```

### Flags

| Flag | 默认 | 说明 |
|---|---|---|
| `[jsonl-path]` | `eval/multidoc-set.jsonl` | 数据集路径 |
| `--sample N` | 跑全集 | 随机抽 N case |
| `--doc-type X` | 跑全部 | 仅跑该 doc_type |
| `--intent X` | 跑全部 | 仅跑该 expected_intent |
| `--strict` | off | must_pass 任一 fail 退 1 |
| `--output FILE` | stdout | 报告写文件（默认 stdout） |
| `--verbose` | off | 打印每 case 详细 SSE 事件 |

### env

| env | 默认 | 说明 |
|---|---|---|
| `EVAL_API` | `http://localhost:3001` | qa-service 端点 |
| `EVAL_ADMIN_EMAIL` | `admin@dsclaw.local` | 登录邮箱 |
| `EVAL_ADMIN_PASSWORD` | `admin123` | 登录密码 |
| `EVAL_TIMEOUT_MS` | `60000` | 单 case dispatch 超时 |
| `EVAL_CONCURRENCY` | `1` | 并发数（默认串行避免 LLM 限流）|

---

## 启动校验（Phase 1：preflight）

### Scenario: qa-service 不可达 → 立即退 1

- When runner 启动
- And `nc -z 127.0.0.1 ${PORT}` 失败
- Then 输出 `❌ qa-service 不可达 (${EVAL_API})`
- And `process.exit(1)`

### Scenario: 登录失败 → 立即退 1

- When `POST ${EVAL_API}/api/auth/login` 返回非 200 / 无 token
- Then 输出 `❌ 登录失败：[error]`
- And `process.exit(1)`

### Scenario: jsonl 文件不存在 → 立即退 1

- When 指定的 jsonl 路径不存在
- Then 输出 `❌ 数据集文件不存在：[path]`
- And `process.exit(1)`

### Scenario: jsonl schema 校验（按 eval-case-schema-spec.md）

- When 任一 case 缺必填字段 / 枚举非法
- Then 退 1（不开始跑测试）

---

## 单 case 执行（Phase 2：per case）

### Scenario: 正常 case 流程

- Given 一条合法 case
- When runner 处理该 case
- Then 步骤：
  1. 构造 body：`{ question, history, session_id: 'eval-D003-${id}' }`
  2. `POST ${EVAL_API}/api/agent/dispatch` SSE
  3. 收集事件流到 `Observed`
  4. 跑 7 类 assertion
  5. 汇总 case 结果到 results 数组

### Scenario: 单 case timeout

- Given case 跑 > `EVAL_TIMEOUT_MS`
- Then 该 case 标 `error: 'timeout'`，所有 assertion 标 fail with `reason: 'timeout'`
- And 继续跑下一 case（不退出）

### Scenario: 单 case dispatch 5xx

- Given dispatch 返回 5xx 或网络错
- Then 该 case 标 `error: '<msg>'`，assertion 全 fail
- And 继续下一 case

### Scenario: SSE 事件解析

- Given dispatch 返回 SSE 流
- When 解析事件
- Then 抽出：
  - `agent_selected` event → `Observed.topIntent`
  - `rag_step` icon='🪄' → `Observed.rewriteByCondense = true`
  - `rag_step` icon='🎭' → `Observed.answerIntent` 抽 label 里的 intent
  - `rag_step` icon='⛔' → `Observed.shortCircuited = true`
  - `trace.citations[]` → `Observed.citations`
  - `content` 序列 → `Observed.answer` 拼接
  - 全部 `data: ...` 行 → `Observed.rawSseLines`

---

## 7 类断言（Phase 3：assertions · 详见 intent-classifier-eval-spec / answer-quality-eval-spec）

```ts
type AssertResult = { pass: boolean; reason: string }

function assertIntent(c, o): AssertResult            // intent-classifier-eval-spec
function assertPatternType(c, o): AssertResult       // answer-quality-eval-spec
function assertKeywords(c, o): AssertResult          // answer-quality-eval-spec
function assertMustNotContain(c, o): AssertResult    // answer-quality-eval-spec
function assertRecallTopK(c, o): AssertResult        // 复用现有 eval-recall 逻辑
function assertTransparencyDeclaration(c, o)         // answer-quality-eval-spec
function assertNonRefusalForLangOp(c, o)             // answer-quality-eval-spec
```

### Scenario: 期望字段为 null → 该 assertion skip + pass

- Given `case.expected_intent = null`
- When 跑 `assertIntent(case, observed)`
- Then 返回 `{ pass: true, reason: 'skipped (no expected_intent)' }`

### Scenario: 7 类 assertion 互相独立

- Given 一条 case 的 `assertIntent` fail，其它都 pass
- When runner 汇总
- Then 该 case 在 dimension 报告中 intent 列 fail，其它列 pass
- And 该 case 总体标 partial fail

---

## 报告输出（Phase 4：aggregation）

### Scenario: 默认报告格式（详见 design.md report 段）

- When 全 60 case 跑完
- Then stdout 输出：
  - 头部：`======== D-003 RAG Multi-doc Eval ========\nDate: <iso>\nTotal: N cases × 7 dims`
  - 按维度 7 行：每行 `维度名 │ pass/total  比例%`
  - 按 doc_type 6 行：同上格式
  - 按 intent 5 行：同上
  - must_pass cases 列表（PASS / FAIL）
  - Failed cases 列表（id + 维度 + 失败原因 + answer prefix 200 字符）

### Scenario: --output FILE 写文件

- Given `--output report.txt`
- Then 报告写到 `report.txt`
- And stdout 仅打印 `✓ 报告已写入 report.txt`

### Scenario: --verbose 打印每 case SSE

- Given `--verbose` flag
- Then 每 case 跑完后 stdout 多打印：
  - `> Q: <question>`
  - `> 🤖 agent: <intent>`  
  - `> 🎭 answer-intent: <intent>`
  - `> 📊 citations: [<asset_ids>]`
  - `> 💬 answer (前 200 字符): <prefix>`
  - `> assertions: intent=✓/✗ pattern=✓/✗ keywords=✓/✗ ...`

---

## 退出码

| 退出码 | 条件 |
|---|---|
| 0 | 默认（无 --strict）/ --strict 且所有 must_pass 都 pass |
| 1 | preflight 失败 / --strict 且 ≥1 must_pass case fail |