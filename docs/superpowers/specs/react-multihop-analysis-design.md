# Explore Draft — ReACT Agent 前置量化：QA 多跳占比分析

> 工作流 C · `superpowers-feature-workflow`（无 OpenSpec）。配套计划：
> `docs/superpowers/plans/react-multihop-analysis-impl-plan.md`。

## 动机

`.superpowers-memory/open-questions.md` 的 **OQ-AGENT-1** 把 "启动 ReACT Agent
change（见 `docs/superpowers/specs/agent-react-loop/explore.md`）" 的前置条件写作：

> 多跳需求 ≥ 20%

但这句话是我们从 WeKnora 的使用场景反推的，**目前没有任何基于本仓库真实数据的度量**。
贸然启动 ReACT change（约 4.5 人天 + 运行期多轮 LLM 成本）风险是：建完发现用户问答里
几乎没有多跳场景，ROI 为负。

本 C 流程交付一个**不改业务代码**的分析脚本，直接查 AGE 里累计的 `Question`/`CITED`
数据得出客观判据。

## 读的代码

- `apps/qa-service/src/services/knowledgeGraph.ts`（`writeCitations()` 把每次问答的
  top-K citations 以 `(:Question)-[:CITED]->(:Asset)` 写入 AGE，fire-and-forget）
- `apps/qa-service/src/services/graphDb.ts`（AGE 连接：kg_db @ 127.0.0.1:5433, user/pass
  默认 `kg/kg_secret`, graph `knowledge`；每连接需 `LOAD 'age'; SET search_path`）
- `scripts/find-zombie-assets.mjs`（pnpm workspace 下 `pg` 模块的 createRequire 解法
  与 CLI 参数风格参考）
- `apps/qa-service/src/routes/mcpDebug.ts`（曾尝试 `WHERE action LIKE 'qa_%'`，但 QA
  路径**没有** `writeAudit` 调用 —— 所以**不能**走 audit_log，必须走 AGE）

## 候选方案评估

| 方案 | 代价 | 风险 | 评分 |
|---|---|---|---|
| A 先给 QA 路径加 `writeAudit({action:'qa_dispatch'})`，等 7 天再统计 | 小 | **决策延迟 2 周**；多套件改动引入回归 | ✗ |
| B 直接查 AGE `Question`+`CITED` 边（本 change 采用） | 最小 | AGE 里已累计的数据可能 ≠ 真实 QA 流量（fire-and-forget 降级路径会丢） | ✓ |
| C 用 LLM-judge 回溯 `answer_feedback` 表 | 中 | 成本 + 主观 | ✗ |
| D 手标 50 个问题做 ground truth | 大 | 慢；小样本代表性弱 | ✗ |

**选 B** 的理由：

1. AGE 的 `CITED` 边是 RAG 管线"写入最后一步"的副产物，只要 `KG_ENABLED=on`（默认）
   且 kg_db 起着，数据就是准确的 —— 已跑过的 eval（ADR-36 验证阶段）+ 真实用户问答
   都会留下印记。
2. 脚本零业务代码依赖，不走 qa-service；对主路径零风险。
3. 可重复执行，窗口可参数化（`--since N` 天）。

## 判据

```
样本量   total_questions  >= 50          （否则"窗口内没人用"）
占比    multihop_ratio   >= 0.20         （ADR-39 D-004 沿用）
两条同时满足 → 启动 agent-react-loop change
任一不满足 → 搁置，记录到 OQ-AGENT-1
```

**为什么是 50 / 20%？**

- **50** 是经验门槛：小于 50 的样本下 20% 这个比例的置信区间过宽（±11% @ 95% CI）。
  用户若觉得当前 QA 流量不足，可以把窗口拉到 `--since 30` 再看。
- **20%** 直接沿用 ADR-39 D-004（OQ-AGENT-1）的原始声明。这是"感觉合理的最低线"：
  ReACT 每问至少多 2-3 次 LLM 调用，若不到 20% 的问题能从 ReACT 里得利，净收益为负。

两个阈值都通过 env var `REACT_MIN_SAMPLE` / `REACT_MIN_MULTIHOP_RATIO` 可覆盖，
便于后续调整而不改脚本。

## 风险

- **AGE 降级丢数据**：`writeCitations` 任一 Cypher 异常即 fire-and-forget 失败，不回补。
  近期 KG_ENABLED 一直是 on，但若 kg_db 有过停机窗口，那段时间的 QA 不会在 AGE 里
  留下痕迹。**缓解**：脚本结果用 `mcpDebug` 已有的 "近 7 天 ingest_done 数" 作粗检，
  若两者数量级差太远，报 warning。（本期不做，follow-up。）
- **问题去重**：`Question` 节点以问题文本 sha1 为主键，MERGE 语义 = 同一问题重复问
  只算一条。这对"占比"度量是**正确的**（不想被 hot question 污染），但对"多跳绝对
  数量"略偏低。
- **跨 Space 可见性**：CITED 写入时不带 space 过滤；统计 = 全局。对判据无影响。
- **时间过滤精度**：AGE 里 `r.at` 是 JS `Date.now()` 写入的 ms 整数。Cypher 层用
  `r.at >= $since`，AGE 会把 agtype 自动处理成 numeric 比较，无需 cast。本地测过。

## 出口

脚本一次运行得出 `START` / `DEFER`；独立于后续 change 流程。

- `START`：
  - 更新 OQ-AGENT-1 标注 "已触发，启动 agent-react-loop change"
  - 启动 B 工作流第二阶段：把 `docs/superpowers/specs/agent-react-loop/explore.md`
    推进到 `openspec/changes/agent-react-loop/`
- `DEFER`：
  - 更新 OQ-AGENT-1 标注 "窗口 N 天样本量 X, 多跳占比 Y%，未达门槛"
  - 不动 `docs/superpowers/specs/agent-react-loop/`（保留为未来再看的草稿）
  - 建议用户 1-2 周后再跑一次

两种出口都需要在 `.superpowers-memory/decisions/` 新开一条 ADR 记录观测值，
这是 C 流程的标准收尾。
