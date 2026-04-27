# Implementation Plan — Eval Set 多跳扩展

> 工作流 C。设计：`docs/superpowers/specs/eval-multihop-expansion-design.md`。
> 上游：ADR-39（WeKnora 借鉴）· ADR-40（Ingest 异步化收尾后下一步）
> ADR（运行后补）：`.superpowers-memory/decisions/2026-04-24-<seq>-multihop-baseline.md`

## 交付清单

| # | 产物 | 路径 | 状态 |
|---|------|------|------|
| 1 | 设计文档 | `docs/superpowers/specs/eval-multihop-expansion-design.md` | ✅ 本轮落盘 |
| 2 | 本实施计划 | `docs/superpowers/plans/eval-multihop-expansion-impl-plan.md` | ✅ 本轮落盘 |
| 3 | 多跳题 stub | `eval/gm-liftgate-multihop.template.jsonl` | ✅ 本轮落盘（AI stub） |
| 4 | `eval-recall.mjs` 加 `asset_hit@K` 指标 | `scripts/eval-recall.mjs` | ✅ 本轮落盘 |
| 5 | 用户填完的正式金标 | `eval/gm-liftgate-multihop.jsonl` | ⏳ **用户人工填 · 约 1 人天** |
| 6 | 首次运行输出 | `eval/_audit-multihop-<date>.json` | ⏳ 用户跑 |
| 7 | 观测结果 ADR + 决策 | `.superpowers-memory/decisions/<next-seq>-multihop-baseline.md` | ⏳ 运行后 |

## 实施步骤（用户视角）

### 1. 对照 stub 填事实（~1 人天）

打开 `eval/gm-liftgate-multihop.template.jsonl`。每条 stub 带三个信息：
- 多跳类型（`compare` / `lookup` / `synthesis`）
- 至少两个 `expected_asset_ids`
- 每个 asset 的锚点提示（`§章节号` 或 `page=[N]`），来自 v4-judge 已有注释的同类位置

具体操作：
```bash
cd /path/to/knowledge-platform
cp eval/gm-liftgate-multihop.template.jsonl eval/gm-liftgate-multihop.jsonl
# 编辑 eval/gm-liftgate-multihop.jsonl
# - 保留 id / expected_asset_ids / comment
# - 把 question 里的 {BLANK} 占位替换成真实事实性问题
# - 把 expected_answer 补上（LLM Judge 用）
```

**填题原则**：
- 优先挑**你在工作中真实遇到过的多文档问题**（如果有），而不是 AI 造出的 artificial 组合
- 如果 stub 的 asset 组合在 PDF 里找不到自然的交集，**跳过这条 stub**（题目数目不是刚性要求，质量 > 数量）
- 最终 ≥ 12 条真多跳题即可触发判据；≥ 20 条更稳

### 2. 跑新 eval（2 分钟）

```bash
# 前提：kg_db / qa-service 都在跑（pnpm dev:up）
node scripts/eval-recall.mjs eval/gm-liftgate-multihop.jsonl
```

输出：新增 `asset_hit@1/3/5` 列。关注两个数：

- **多跳题平均 `asset_hit@5`**（仅计 `expected_asset_ids.length >= 2` 的行）
- 与 `recall@5` 的差值（差值越大说明部分命中越多）

建议保存：
```bash
node scripts/eval-recall.mjs eval/gm-liftgate-multihop.jsonl 2>&1 \
  | tee eval/_audit-multihop-$(date +%F).txt
```

### 3. 读结论 & 写 ADR（按 design.md §判据 表格）

根据 `asset_hit@5` + `groundedness`（跑 v4-judge 的 judge 分）得出：

```
if asset_hit@5 >= 80% AND groundedness >= 70%:
  → 结论: DEFER_BOTH · 关闭 OQ-AGENT-1 + ADR-39 D-003 Phase 2 永久搁置
elif asset_hit@5 < 70%:
  → 结论: START_OAG_PHASE_2 · 启动 KG 三路召回 change
elif recall@5 >= 70% AND groundedness < 70%:
  → 结论: START_REACT · 启动 OQ-AGENT-1 ReACT change
else:
  → 结论: BOTH · 先 OAG Phase 2 后 ReACT
```

ADR 模板（在 `.superpowers-memory/decisions/` 新开）：

```markdown
# ADR <date>-<seq> — 多跳题基线首次观测 + 触发决策

## Context
OQ-AGENT-1 ReACT 与 ADR-39 D-003 OAG Phase 2 的启动触发条件。
本 ADR 关闭 ADR-39 D-004 的第三项（"eval 工具链 + 金标扩容"）。

## Observation
- 多跳题数量: X
- 平均 asset_hit@5: X.XX
- 平均 recall@5: X.XX
- 平均 groundedness (从 v4-judge): X.XX（或 N/A）
- 未覆盖题: <逐条列>

## Decision
- verdict: START_OAG_PHASE_2 / START_REACT / BOTH / DEFER_BOTH
- 理由: <脚本输出原文>

## Consequences
- 若 DEFER_BOTH: OQ-AGENT-1 迁"已关闭"；ADR-39 D-003 Phase 2 章节追加"永久搁置"
- 若 START_*: 下一轮 session 起对应 change 的 Explore

## Links
- 设计: docs/superpowers/specs/eval-multihop-expansion-design.md
- 数据: eval/gm-liftgate-multihop.jsonl · eval/_audit-multihop-<date>.txt
- 上游: ADR-39 D-001 / D-003 · ADR-40（ingest-async pipeline 收尾）
```

### 4. 同步开放问题 & snapshot

- 若 `DEFER_BOTH`：
  - `open-questions.md` OQ-AGENT-1 迁"已关闭"（带 ADR 引用）
  - `openspec/changes/ontology-oag-retrieval/design.md` §Phase 2 路线图 追加一行
    "2026-04-XX 观测：多跳 asset_hit@5 = X，触发条件不成立，永久搁置"
- 若任一 `START_*`：
  - `open-questions.md` OQ-AGENT-1 更新为"已触发 · <日期>"（仍保留在未决区直到 change 完成）
  - 下轮 session 起 Explore：
    - `docs/superpowers/specs/agent-react-loop/explore.md` 已存在，推进为 `openspec/changes/agent-react-loop/`（B 工作流第二步）
    - OAG Phase 2：基于 ADR-39 D-003 §Phase 2 路线图 起新 change `kg-graph-retrieval`（B 工作流）

## 无需改动

- `apps/qa-service/` / `apps/web/` / `apps/mcp-service/` 业务代码
- 现有 `eval/gm-liftgate32-v*.jsonl` 单跳金标（作为 baseline 保留）
- `openspec/changes/` 任何 change
- `infra/docker-compose.yml`
- `package.json`（脚本用已有 pg 包）

## 验证

- [x] `node --check scripts/eval-recall.mjs`（语法）
- [x] `pnpm -r exec tsc --noEmit` 三包全绿
- [ ] 用户按步骤 1 填完 stub，步骤 2 跑脚本拿到数值
- [ ] 结果落 ADR
- [ ] 同步 OQ / snapshot

## 回滚

产物零业务代码依赖，零副作用：
- `eval/gm-liftgate-multihop.template.jsonl` 只是模板，删了也不影响
- `eval/gm-liftgate-multihop.jsonl` 是用户拷贝版本
- `scripts/eval-recall.mjs` 新增字段**加法变更**，老消费方忽略即可；回滚删改动代码即可
