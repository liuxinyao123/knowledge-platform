# ADR 2026-04-24-36 — Eval Golden Set 与 SERIAL ID 漂移

> 工作流 C · `superpowers-feature-workflow`（无 OpenSpec）。设计 / 计划：
> `docs/superpowers/specs/eval-golden-set-realign-design.md` / `docs/superpowers/plans/eval-golden-set-realign-impl-plan.md`。

## 现象

2026-04-24 跑 ontology 三件套验证后跑 `node scripts/eval-recall.mjs eval/gm-liftgate32-v2.jsonl` 时出现 0/37 命中。看似 RAG 严重退化，实则 golden set 里写的 `expected_asset_ids:[3]` 在当前 DB 是僵尸记录（chunks=0），真身在 `id=5`。

| asset_id | name | chunks | 状态 |
|---|---|---|---|
| 1 | LFTGATE-3 Liftgate_Liftglass gas strut guidelines 19Oct2018.pdf | 146 | 活 |
| 2 | Bumper Integration BP rev 11.pdf | 233 | 活 |
| 3 | LFTGATE-32_Liftgate Swing and Tool Clearance Development_Rev.pdf | **0** | **僵尸** |
| 4 | (gap) | — | 已 DELETE |
| 5 | LFTGATE-32_Liftgate Swing and Tool Clearance Development_Rev.pdf | 1084 | 活（同名重 ingest） |

## 根因

PostgreSQL `SERIAL` 序列**永不回收**已用 ID。重 ingest 走"删旧建新"路径会拿到更大的新 ID。`metadata_asset` 表里旧行被 ON DELETE CASCADE 带走 chunks（参见 ADR-30 的 FK 设计），但行本身没被自动清理 —— 因为 ADR-30 的 DELETE 端点要求显式调用，不会副作用清理。

Golden set 是某次"清洁状态"下手工标注的 ID，跟 DB 状态会随时间漂移，且没有任何自动告警机制。

## 决策

| # | 决策 | 备注 |
|---|------|------|
| D-001 | 修数据：把 `gm-liftgate32-{v2,v3-annotated,v4-judge}.jsonl` 里所有 `expected_asset_ids: [3]` 改成 `[5]` | sed in-place；`gm-liftgate32-only.jsonl` 是另一个 DB 快照（id=35），不动 |
| D-002 | 加 `scripts/find-zombie-assets.mjs` —— 列出 `chunks=0` 的资产；`--delete` flag 走 ADR-30 的 DELETE API（带 audit）；`--json` 给 CI 消费 | 默认只列不删；删除走 HTTP 端点，不直接 SQL |
| D-003 | 不改 `eval-recall.mjs` 自身做 PG preflight | 脚本目前只走 HTTP API；引入 PG 直连超出"独立 UI 细节"的 C 流程边界；推到 OQ-EVAL-1 |
| D-004 | 修改 jsonl 文件头 comment："已绑定 asset_id=3" → "已绑定 asset_id=5（2026-04-23 重 ingest 后新 ID；ADR-36 实施）" | 让以后维护人看到 comment 就知道历史 |

## 代码清单

### 新增
- `scripts/find-zombie-assets.mjs`（150 行；pg 直连 + 表格输出 + 可选交互删除）
- `docs/superpowers/specs/eval-golden-set-realign-design.md`
- `docs/superpowers/plans/eval-golden-set-realign-impl-plan.md`

### 修改
- `eval/gm-liftgate32-v2.jsonl`：37 处 `[3]` → `[5]` + 头部 comment
- `eval/gm-liftgate32-v3-annotated.jsonl`：37 处 `[3]` → `[5]` + 头部 comment
- `eval/gm-liftgate32-v4-judge.jsonl`：37 处 `[3]` → `[5]` + 头部 comment
- `.superpowers-memory/open-questions.md`：新增 OQ-EVAL-1

## 向后兼容

- `eval-recall.mjs` / `evalRunner.ts` / Web `/eval` 页面 0 改动
- `gm-liftgate32-only.jsonl` 用 id=35 的另一个 DB 快照，**不修改**
- 无新依赖（脚本用项目已有的 `pg` 包）

## 验证

- `grep -cE '"expected_asset_ids":[[:space:]]*\[3\]'` 三个文件由 37 → 0
- `grep -cE '"expected_asset_ids":[[:space:]]*\[5\]'` 三个文件由 0 → 37
- `node --check scripts/find-zombie-assets.mjs` 语法 OK
- 用户本机重跑 `node scripts/eval-recall.mjs eval/gm-liftgate32-v2.jsonl` recall@5 应显著回升（具体数字由用户记录后追加到 PROGRESS）

## 关联

- 上游：ADR-30 `asset-delete`（FK ON DELETE CASCADE 与 DELETE 端点设计）
- 上游：ADR-32 `ingest-diagnostics`（重 ingest 的清理路径）
- 未决：OQ-EVAL-1（eval-recall 是否加 PG preflight）
- 不是 ADR-33/34/35 引起的 regression（OAG 不影响召回阶段，只在 rerank 后扩展实体上下文）
