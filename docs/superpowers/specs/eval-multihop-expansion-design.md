# Explore Draft — Eval Set 多跳扩展（解锁 OQ-AGENT-1 / OAG Phase 2）

> 工作流 C · `superpowers-feature-workflow`（无 OpenSpec）。配套计划：
> `docs/superpowers/plans/eval-multihop-expansion-impl-plan.md`。

## 动机

ADR-39 D-004 把 3 条 WeKnora 借鉴点挂到 `open-questions.md`。ADR-40 关闭了其中 1 条
（Ingest 异步化）。剩下两条的启动门槛都卡在 **"eval 工具链 + 金标集扩容"**：

| OQ | 启动判据 | 当前阻塞 |
|---|---|---|
| OQ-AGENT-1 ReACT 升级 | eval set 里 **多跳题 groundedness < 70%** 或 生产 3 月真实流量 | 当前 37 题全是单文档 (expected_asset_ids=[5])，**根本没法测多跳** |
| OAG Phase 2 KG 三路召回 | eval 里召回率下降（金标集扩到 200+ 题 recall@5 不再触顶）| 同上，样本集太小且单一 |

本 change 不实现 ReACT、不实现 KG 三路召回，**只造判据数据**：

1. 扩入 ≥ 20 道真多跳题（`expected_asset_ids.length >= 2`）
2. 给 `eval-recall.mjs` 加 `asset_hit@K` 严格覆盖度指标
3. 跑一遍得到基线数值，直接决定 OQ-AGENT-1 / OAG Phase 2 该不该启动

## 读的代码

- `eval/gm-liftgate32-v4-judge.jsonl`（37 题 · 当前金标 · 全 `[5]`）
- `eval/gm-liftgate.template.jsonl`（70 题模板 · 两 asset 占位 `[12]/[13]`）
- `scripts/eval-recall.mjs` · `recallAt(K, expected, retrieved)` 已支持 multi-expected（partial credit）
- `apps/qa-service/src/services/ragPipeline.ts` 末尾 `recordCitations` 把 top-K 写 AGE
- 可用文档：DB 当前 `metadata_asset` 表里
  - `id=1` LFTGATE-3 Liftgate_Liftglass gas strut guidelines
  - `id=2` Bumper Integration BP rev 11.pdf
  - `id=5` LFTGATE-32 Liftgate Swing and Tool Clearance Development

## 关键定义

### 多跳题 = `expected_asset_ids.length >= 2`

只要一道题标注了 2 个或以上 `expected_asset_ids`，就算多跳。包含三种 flavor：

| Flavor | 典型形状 | 判据作用 |
|---|---|---|
| **跨文档对比** (cross-doc compare) | "A 文档的 X 值和 B 文档的 Y 值相差多少" | 检测召回缺失（缺任一文档就答不完整） |
| **跨文档追溯** (cross-doc lookup) | "尾门的缓冲块设计参照哪份规范里的硬度标准" | 检测 cross-reference（需要从一文档跳到另一文档解引用） |
| **多步综合** (multi-step synthesis) | "满足密封力 300N 同时允许 ±4mm 调节，选哪种缓冲块" | 检测多个事实的综合（即便 top-5 召到两文档，LLM 可能漏掉一个）|

### 新指标：`asset_hit@K`（严于 recall@K）

```
asset_hit@K = 1  IFF  所有 expected_asset_ids ⊆ top-K(retrieved)
              0  otherwise
```

与 `recall@K` 对比：

| 题 | expected | top-3 | `recall@3` | `asset_hit@3` |
|---|---|---|---|---|
| Q1 | `[5]` | `[5, 2, 1]` | 1.0 | 1 |
| Q2 | `[2, 5]` | `[5, 2, 1]` | 1.0 | 1 |
| Q3 | `[2, 5]` | `[5, 1, 3]` | **0.5** | **0** |
| Q4 | `[1, 2, 5]` | `[5, 2, 7]` | 0.67 | 0 |

**为什么需要它**：`recall@K` 对多跳题给"部分分"，但 ReACT 要解决的正是"top-K 缺某个文档时 LLM 被漏掉关键事实"的场景。严格 `asset_hit@K` 才准确度量这个瓶颈。

### 判据（跟 ADR-39 / OQ-AGENT-1 对齐）

跑完新 eval set（原 37 + 新 ≥ 20 = **57+ 题**）后看：

| 数值 | 结论 | 触发 |
|---|---|---|
| 多跳题 `asset_hit@5` < 70% | 召回缺失多跳文档 | **OAG Phase 2 启动**（KG 三路召回） |
| 多跳题 `recall@5` ≥ 70% 且 **groundedness < 70%** | 召回到了但 LLM 没综合好 | **OQ-AGENT-1 启动**（ReACT） |
| 多跳题 `asset_hit@5` ≥ 70% 且 groundedness ≥ 70% | 当前 pipeline 已覆盖多跳 | 两条都**永久搁置** |

`groundedness` 指标在 `eval/gm-liftgate32-v4-judge.jsonl` 的 LLM Judge 流程里
已经有（见 `evalRunner.ts` 的 `answerJudge`），**本 change 不新增**——用现有 judge 跑
多跳题即可。

## 候选方案评估

| 方案 | 代价 | 风险 | 评分 |
|---|---|---|---|
| A 我（AI）凭空写具体事实多跳题 | 0 | **幻觉**；我没读 PDF | ✗ |
| B **我造结构化 stub + 用户填事实**（本 change 采用） | 小 | 需要用户 ~1 人天标注 | ✓ |
| C 跑 LLM 自动生成题目然后人工 review | 中 | LLM 编出来的多跳题真实性存疑；review 成本高 | 未来 |
| D 改 eval judge 自动识别现有题是否潜在多跳 | 中 | 当前 37 题都是 `[5]`，没有多跳素材 | ✗ |

**选 B** 的理由：用户 2026-04-22 亲手标注过 37 题（看 v4-judge 的页码/章节引用精度），
继续由用户标多跳题保证**工程事实准确性**，我只负责把"哪些类型的题、怎么写、怎么组织"
的框架搭好。

## 风险

### 高

- **模板写出来用户不愿意填**：20+ 道题要用户逐一翻 3 个 PDF 对事实，工作量不小。
  **缓解**：stub 精炼到 20 道，每道给具体引用锚点（§章节号 或 页码提示），让用户
  打开 PDF 对着填就行；不强求用户自己构思新问题。
- **多跳题设计本身偏 artificial**：硬凑"同时引用两文档"的问题可能在真实用户场景下
  很少见。**缓解**：后续金标扩到 200+ 题时按真实用户问答的分布抽样；本期只求"足够
  触发判据"而不是"分布完美"。

### 中

- **LFTGATE-3 / Bumper / LFTGATE-32 三文档可能主题不相邻**：三者分别讲 gas strut 结构、
  保险杠集成、工具间隙开发。跨文档问题的"自然度"弱。
  **缓解**：stub 里优先挑概念可能重合的：几何公差 / 硬度参数 / 密封面布局 等
  机械设计的跨系统通用要素。
- **`asset_hit@5` 计算语义的边界**：对 `expected_asset_ids.length=1` 的老题，它等同于
  `recall@5 ≥ 1.0 ? 1 : 0` → 跟 `recall@5 == 1` 严格等价。这是所期望的行为（单跳题不受
  新指标影响）。

### 低

- eval-recall.mjs 改动小（+~20 行），不破坏现有输出格式；老客户端 / CI 消费 JSON 时
  新增字段是加法。

## Out of Scope

- **不新增** LLM-as-judge 指标（`groundedness` 已在 `answerJudge.ts` 里）。
- **不改** 现有 37 题单跳数据（它们作为 recall@k 基线保留）。
- **不写**跑真实 eval 的自动化 CI（手动触发就行；ADR-36 里的 OQ-EVAL-1 已挂着）。
- **不跑**真实数据得出 START / DEFER 结论——这是用户填完题再跑的事。
- **不合并**回 golden-set.template（两边保持分开：单跳 baseline / 多跳扩展集）。

## 出口

用户填完 stub → 跑 `node scripts/eval-recall.mjs eval/gm-liftgate-multihop.jsonl` →
看 `asset_hit@5` 与 `recall@5` 差值 → 按"判据"表决定启动 ReACT 或 OAG Phase 2 或
两条都搁置。结果落一条新 ADR。

## 风险对照表

| 场景 | 预期 | 处理 |
|---|---|---|
| 多跳题 asset_hit@5 = 100% | 当前 pipeline 已能召回跨文档 | 两条都永久搁置；关掉 OQ-AGENT-1 / 关掉 ADR-39 D-003 Phase 2 |
| 多跳题 asset_hit@5 = 50-80% | 有部分召回缺失 | OAG Phase 2 启动 |
| 多跳题 asset_hit@5 < 50% + groundedness 也低 | 召回 + 综合都有问题 | 两条同时启动（先 OAG Phase 2 再 ReACT） |
| 多跳题 asset_hit@5 ≥ 80% 但 groundedness < 70% | 召回到了 LLM 漏事实 | OQ-AGENT-1 ReACT 启动 |
