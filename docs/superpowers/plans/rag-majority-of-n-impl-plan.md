# Impl Plan · D-002.4 RAG eval-multidoc majority-of-N（方案 X · 离线 only）

> 工作流：C `superpowers-feature-workflow` · 阶段 Plan
> Explore：`docs/superpowers/specs/rag-majority-of-n-design.md`（方案 X 已选）

## 目标

修改 `scripts/eval-multidoc.mjs`：每个 case 跑 N 次（default 1，常用 N=3），按"多数通过"规则汇总。让评测分数从单次抖动里 statistical-smooth 出来——明确哪些 fail 是 LLM 抖动（≥ 2/3 跑过 = 抖动），哪些是系统问题（0/3 跑过 = 真问题）。**production 完全不动**。

## 改动文件清单

| 文件 | 改动 |
|---|---|
| `scripts/eval-multidoc.mjs` | + `--repeat N` flag；+ `--case <id>` flag（顺手加，user 之前用过被忽略）；per-case 跑 N 次；compute majority；display + aggregate 全面改造 |
| `docs/superpowers/specs/rag-majority-of-n-design.md` | （Explore，已写）|
| `docs/superpowers/plans/rag-majority-of-n-impl-plan.md` | 本文件 |

## 改造步骤（按顺序，每步 ≤ 10 分钟）

### Step 1 · 新 CLI flags

加 `--repeat N`（default 1）、`--case <id>`（按 case.id 精确过滤）。

```js
const REPEAT = Math.max(1, Number(getFlag('--repeat') || 1) || 1)
const CASE_FILTER = getFlag('--case')   // 按 case.id 精确匹配
```

filter 段加：

```js
if (CASE_FILTER) cases = cases.filter((c) => c.id === CASE_FILTER)
```

### Step 2 · 多数决定规则

新加纯函数 `majorityResult(passRates, N)`：

```js
// per-dim: { pass: boolean, reason: string, ... }
// 多数：pass 计数 ≥ ceil(N/2) 算 majority pass
function majorityVote(perRunResults, N) {
  // perRunResults: [{ pass, reason }, ...]，长度 N
  const passCount = perRunResults.filter((r) => r?.pass).length
  const threshold = Math.ceil(N / 2)
  const stable = passCount === N
  const majorityPass = passCount >= threshold
  // reason 取首个 fail 的，或最后一个 pass 的
  const reasonsSet = new Set(perRunResults.map((r) => r.reason))
  return {
    pass: majorityPass,
    stable,                       // 3/3 全过为 stable
    passCount,
    total: N,
    reason: majorityPass
      ? `majority ${passCount}/${N} pass`
      : `only ${passCount}/${N} pass; ${[...reasonsSet].slice(0, 2).join('; ')}`,
  }
}
```

skipped reason（如 `skipped: ...`）特殊处理：N 跑里只要任一 skip 全 skip，反映在 majorityResult.reason='skipped'。

### Step 3 · per-case 多跑

把现有 per-case 处理抽成函数 `runOnce(c, token)`，返回 `{ observed, error, assertResults }`。

主循环改：

```js
for (let i = 0; i < cases.length; i++) {
  const c = cases[i]
  process.stdout.write(`[${i + 1}/${cases.length}] ${c.id} (${c.doc_type}) ... `)

  const runs = []
  for (let r = 0; r < REPEAT; r++) {
    runs.push(await runOnce(c, token))
  }

  // 算 majority per-dim
  const majorityResults = {}
  for (const [name] of ASSERTIONS) {
    const perRun = runs.map((rn) => rn.error
      ? { pass: false, reason: `error: ${rn.error}` }
      : rn.assertResults[name])
    majorityResults[name] = majorityVote(perRun, REPEAT)
  }

  // 显示：N=1 时维持原行格式；N>1 加跑次徽章
  const allMajPass = Object.values(majorityResults).every((m) => m.pass)
  const allStable = Object.values(majorityResults).every((m) => m.stable)
  const badge = REPEAT > 1
    ? (allStable ? ok(`STABLE`) : allMajPass ? warn(`MAJORITY`) : bad(`FAIL`))
    : (allMajPass ? ok('PASS') : bad('FAIL'))
  console.log(`${badge} ${dim(`(${runs.filter((r) => !r.error).length}/${REPEAT} runs ok)`)}`)

  results.push({ case: c, runs, majorityResults })
}
```

### Step 4 · 聚合统计改用 majorityResults

把现有 by-dim / by-doc-type / by-intent / must_pass 四个聚合段全部改用 `majorityResults` 而不是 `assertResults`。`every((ar) => ar.pass)` 仍用——多数决定后的 pass 与原语义一致。

### Step 5 · 新增"抖动稳定性"报告（仅 REPEAT > 1 时）

在 must_pass 之后，failed cases 之前插入新章节：

```js
if (REPEAT > 1) {
  console.log(`\n${C.bold}稳定性报告（${REPEAT} 次跑）:${C.reset}`)
  // 分类：stable (N/N) / flaky (≥majority but < N) / broken (< majority)
  const stableCount = results.filter((r) =>
    Object.values(r.majorityResults).every((m) => m.stable)
  ).length
  const flakyCases = results.filter((r) =>
    Object.values(r.majorityResults).every((m) => m.pass) &&
    Object.values(r.majorityResults).some((m) => !m.stable)
  )
  const brokenCases = results.filter((r) =>
    Object.values(r.majorityResults).some((m) => !m.pass)
  )
  console.log(`  ${ok('STABLE')}  ${stableCount}/${results.length}（每维度 ${REPEAT}/${REPEAT} 跑过）`)
  console.log(`  ${warn('FLAKY')}   ${flakyCases.length}/${results.length}（抖动但多数过）`)
  console.log(`  ${bad('BROKEN')}  ${brokenCases.length}/${results.length}（多数不过 = 系统问题）`)
  if (flakyCases.length > 0) {
    console.log(`\n  ${dim('Flaky 详情:')}`)
    for (const r of flakyCases) {
      const dims = Object.entries(r.majorityResults)
        .filter(([_, m]) => !m.stable && m.pass)
        .map(([n, m]) => `${n} ${m.passCount}/${m.total}`)
      console.log(`    ${warn('~')} ${r.case.id}: ${dims.join(', ')}`)
    }
  }
}
```

### Step 6 · failed cases 详情升级

REPEAT > 1 时，failed case 详情显示每维度跑次比：

```
  ✗ D003-V3A cn_product_doc
      keywords: 1/3 pass; missing ["数据权限"] (run 1, 3)
      transparency: 2/3 pass; missing transparency (run 2)
```

### Step 7 · 顶部 banner 加 REPEAT 信息

```js
if (REPEAT > 1) console.log(`${dim('Repeat:')} ${REPEAT} (majority threshold: ${Math.ceil(REPEAT / 2)})`)
```

## 不在范围

- **production generateAnswer 不动**（方案 X 的核心边界）
- 不加 `--parallel-runs` flag（先 serial，避免 SSE 服务器并发压力；后续再说）
- 不改 `eval/multidoc-set.jsonl`（数据集不动）
- 不改 production 任何代码——纯评测脚本工具
- 不向 production 暴露新 env

## 测试 case（手工 / verify 阶段）

| 场景 | 命令 | 期望 |
|---|---|---|
| N=1 兼容 | `node scripts/eval-multidoc.mjs` | 行为同 baseline 8（`PASS`/`FAIL` 标签，结构与现在一致）|
| N=3 全集 | `node scripts/eval-multidoc.mjs --repeat 3` | 多打印「稳定性报告」，stable/flaky/broken 三档分类 |
| --case 过滤 | `node scripts/eval-multidoc.mjs --case D003-V3E` | 只跑 V3E 一个 |
| --case + --repeat | `node scripts/eval-multidoc.mjs --case D003-V3E --repeat 3` | 仅 V3E 跑 3 次 |
| --case + --repeat + --verbose | `node scripts/eval-multidoc.mjs --case D003-V3A --repeat 3 --verbose` | 显示 V3A 每跑 keyword miss 的详细原因 |

## Verify 阶段命令

```bash
# 1. N=1 兼容性（确保不破坏 baseline 行为）
node scripts/eval-multidoc.mjs > /tmp/v1.txt && tail -40 /tmp/v1.txt

# 2. N=3 全集（生成 baseline 8 的 stability portrait）
node scripts/eval-multidoc.mjs --repeat 3 > /tmp/v3.txt && cat /tmp/v3.txt

# 3. flaky 维度细看
node scripts/eval-multidoc.mjs --case D003-V3A --repeat 3 --verbose
node scripts/eval-multidoc.mjs --case D003-V3D --repeat 3 --verbose
node scripts/eval-multidoc.mjs --case D003-sop-数值 --repeat 3 --verbose
```

## 完成判据

1. N=1 跑产出与 baseline 8 兼容（intent 维度 / 失败 case 列表与 D-002.3 verify 时一致）
2. N=3 跑能成功打印「稳定性报告」三档（STABLE / FLAKY / BROKEN）
3. V3A keywords / V3D keywords / sop-数值 pattern 任一被分类为 FLAKY → 印证「LLM 抖动而非系统问题」假设
4. 任一 case 被分类为 BROKEN → 暴露需后续 prompt / pipeline 介入的真问题
5. 现有 vitest 套件零回归（本特性纯改 scripts，不改任何 src/**）

## 工作量切片

| Step | 估时 |
|---|---|
| 1 CLI flags | 3 min |
| 2 majorityVote 函数 | 5 min |
| 3 per-case 多跑 + runOnce 抽函数 | 8 min |
| 4 聚合统计改用 majorityResults | 5 min |
| 5 稳定性报告新章节 | 8 min |
| 6 failed cases 详情升级 | 5 min |
| 7 顶部 banner | 1 min |
| Verify 跑 + 调整 | 10 min |
| **合计** | **~45 分钟**（实际可能 ~30）|
