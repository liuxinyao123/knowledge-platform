# Implementation Plan — ReACT 前置量化分析

> 工作流 C。设计：`docs/superpowers/specs/react-multihop-analysis-design.md`。
> ADR（运行后补）：`.superpowers-memory/decisions/<next-seq>-react-multihop-analysis.md`。

## 交付清单

| # | 产物 | 路径 | 状态 |
|---|------|------|------|
| 1 | 分析脚本 | `scripts/analyse-qa-multihop.mjs` | ✅ 本轮已落盘 |
| 2 | 设计文档 | `docs/superpowers/specs/react-multihop-analysis-design.md` | ✅ 本轮已落盘 |
| 3 | 本实施计划 | `docs/superpowers/plans/react-multihop-analysis-impl-plan.md` | ✅ 本轮已落盘 |
| 4 | 首次运行输出 | `docs/superpowers/plans/react-multihop-analysis-run-<date>.json` | ⏳ 用户本机跑 |
| 5 | 观测结果 ADR | `.superpowers-memory/decisions/2026-04-24-<seq>-react-multihop-first-run.md` | ⏳ 运行后 |
| 6 | OQ-AGENT-1 状态更新 | `.superpowers-memory/open-questions.md` | ⏳ 运行后 |

## 实施步骤

### 1. 本地冒烟（用户 Mac，无需 docker 重启）

```bash
# 前提：kg_db 容器在跑（`docker ps | grep kg_db` 应看到 apache/age:release_PG16_1.6.0）
# 若未起：pnpm dev:up（会带起 kg_db）

# 默认 7 天窗口
node scripts/analyse-qa-multihop.mjs

# 样本不够大时，拉到 30 天
node scripts/analyse-qa-multihop.mjs --since 30

# 想看常见共现资产组合
node scripts/analyse-qa-multihop.mjs --since 30 --top-pairs

# 结构化输出存档
node scripts/analyse-qa-multihop.mjs --since 30 --json \
  > docs/superpowers/plans/react-multihop-analysis-run-$(date +%F).json
```

### 2. 读取脚本输出，三种情形

**情形 A — 无数据（total=0）**

脚本会自动提示可能原因（`KG_ENABLED=0` / kg_db 未起 / 窗口内无 QA）。
逐一排查：

```bash
# 1) 确认 KG_ENABLED
grep KG_ENABLED infra/.env apps/qa-service/.env

# 2) 确认 kg_db 可达
docker ps | grep kg_db
psql -h 127.0.0.1 -p 5433 -U kg -d kg -c "SELECT 1"   # 密码 kg_secret

# 3) 喂几个问题（Web /qa 页发 5-10 条），再跑脚本
```

**情形 B — 有数据但未达门槛（DEFER）**

脚本 `exit code = 1`。记录当前数值到一条新 ADR（模板见下）。
不动 `docs/superpowers/specs/agent-react-loop/`，保留作未来再评。

**情形 C — 达到门槛（START）**

脚本 `exit code = 0`。开始 B 工作流第二阶段：把
`docs/superpowers/specs/agent-react-loop/explore.md` 推进为正式
`openspec/changes/agent-react-loop/{proposal,design,tasks}.md + specs/`。
这是下一轮 session 的事，不在本 C 流程 scope。

### 3. 记录 ADR（两种情形都要做）

模板：

```markdown
# ADR <date>-<seq> — ReACT 多跳占比首次观测

## Context
OQ-AGENT-1 的前置门槛（≥ 50 样本 + ≥ 20% 多跳占比）首次度量。
窗口：近 N 天。数据源：AGE `kg_db` graph=knowledge。

## Observation
- total_questions: X
- single_doc: X (P%)
- multihop (asset≥2): X (P%)
- deep_multihop (asset≥3): X (P%)
- 分布：见 `docs/superpowers/plans/react-multihop-analysis-run-<date>.json`

## Decision
- verdict: START / DEFER
- 理由: <脚本输出原文>

## Consequences
- 若 START: 启动 agent-react-loop change（B 工作流）
- 若 DEFER:
  - OQ-AGENT-1 更新"下次观测窗口 + 下次重跑时间"
  - 不动 explore.md

## Links
- 设计: docs/superpowers/specs/react-multihop-analysis-design.md
- 脚本: scripts/analyse-qa-multihop.mjs
- 上游 ADR: ADR-39（WeKnora 借鉴点 / OQ-AGENT-1 起源）
- 关联 Open Question: OQ-AGENT-1
```

### 4. 同步 `open-questions.md`

`OQ-AGENT-1` 条目下 **追加**（不删旧内容，保留"等待事件"原文）：

```markdown
- **观测 <date>**: total=X, multihop_ratio=Y%, verdict=<START/DEFER>（见 ADR-<seq>）
```

## 无需改动

- `apps/qa-service/` 任何源码；
- `openspec/changes/` 任何文件；
- `infra/docker-compose.yml`；
- `package.json`（脚本用 createRequire 复用 `apps/qa-service/node_modules/pg`，零新依赖）。

## 验证

- [x] `node --check scripts/analyse-qa-multihop.mjs` 语法 OK
- [ ] 用户本机跑一次 `node scripts/analyse-qa-multihop.mjs`，观察输出
- [ ] 运行结果记录到 ADR
- [ ] open-questions.md 同步更新

## 回滚

脚本是只读的，无副作用。若判据误导，只需：
1. 删 ADR 或新开一条反对意见 ADR；
2. `rm scripts/analyse-qa-multihop.mjs`（可选；不删也不阻塞）；
3. OQ-AGENT-1 回到原始等待事件描述。
