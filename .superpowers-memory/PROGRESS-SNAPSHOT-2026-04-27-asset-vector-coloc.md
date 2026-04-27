# PROGRESS-SNAPSHOT 2026-04-27 · asset-vector-coloc 上线 + LanceDB 借鉴评估归档

> 本快照记录 2026-04-27 跑完整 B 工作流四步的实际进度，含两条独立但耦合的成果：
> (1) Citation 透图（multimodal 链路用户体感打通）； (2) LanceDB 借鉴评估闭环（halfvec 默认 OFF + 三条 OQ 登记）。

---

## 一、本日交付物

### 1.1 Item 2 · Citation 透图（生产可用）

| 改点 | 文件 | 行为 |
|---|---|---|
| `Citation` 类型 | `apps/qa-service/src/ragTypes.ts` | 加可选 `image_id?: number` / `image_url?: string` |
| `AssetChunk` 类型 | `apps/qa-service/src/services/knowledgeSearch.ts` | retrieval `SELECT` 列表追加 `kind`、`image_id` |
| 拼装逻辑 | `apps/qa-service/src/services/ragPipeline.ts#toCitation` | `kind='image_caption' && image_id>0` → 回填 image_id + image_url |
| Flag | env `CITATION_IMAGE_URL_ENABLED=true` 默认 | 关 → 不回填，前端退回纯文本 |
| 前端消费 | QA/Agent/Notebooks ChatPanel × 3 处 + `apps/web/src/api/notebooks.ts` | 64×64 缩略图（hover 卡 96×96）+ Citation 接口同步加字段 |
| 单测 | `apps/qa-service/src/__tests__/citationImage.test.ts` | 8 case 全绿 |

### 1.2 Item 1 · halfvec 迁移代码（默认 OFF · opt-in）

| 改点 | 文件 | 行为 |
|---|---|---|
| 迁移函数 | `apps/qa-service/src/services/pgDb.ts#migrateToHalfvec` | 三层兜底（flag/版本/列已 halfvec）+ 幂等 ALTER + 重建 IVFFlat halfvec_cosine_ops |
| Flag | env `PGVECTOR_HALF_PRECISION=false` **默认 OFF**（ADR-44 锁定） | `=true` 才迁；翻 default 的理由见 §三 |
| 回滚脚本 | `scripts/rollback-halfvec.mjs` | dry-run 默认；`--commit` 实跑；走 qa-service `getPgPool` 复用 pg 依赖 |
| 单测 | `apps/qa-service/src/__tests__/halfvecMigration.test.ts` | 9 case 全绿 |

### 1.3 工作流产物

- ADR：`.superpowers-memory/decisions/2026-04-27-44-lance-borrowing-asset-vector-coloc.md`
- OpenSpec change（活契约，供下游引用）：`openspec/changes/asset-vector-coloc/{proposal,design,specs/asset-vector-coloc-spec,tasks}.md`
- 归档 spec：`docs/superpowers/archive/asset-vector-coloc/design.md`（从 `specs/pgvector-modernization/` 迁来）
- 三条 OQ 已写入 `.superpowers-memory/open-questions.md`：OQ-VEC-QUANT-V2 / OQ-CAPTION-DUAL-EMBED / OQ-EVAL-RECALL-DRIFT

---

## 二、指标块（基线条件锚定 · 见 ADR-44 D-006）

> 之后若再做 recall 回归，必须照抄本块的"测量条件锚"格式。

### 2.1 测量条件锚

| 项 | 值 |
|---|---|
| 测量时间 | 2026-04-27 |
| Corpus | `metadata_field` rows = 2,036；`chunk_abstract` rows = 850 |
| Eval set | `eval/gm-liftgate32-v2.jsonl`（37 题，本次未改 commit）|
| qa-service `MIN_SCORE` | 0.5（`ragPipeline.ts` 常量）|
| `RAG_RECALL_TOP_N` | 默认 20 |
| pgvector 版本 | 0.8.2 |
| 列类型 | `vector(4096)`（已从 halfvec rollback；ADR-44 默认 OFF）|
| `PGVECTOR_HALF_PRECISION` | false（默认）|
| `CITATION_IMAGE_URL_ENABLED` | true（默认）|

### 2.2 实测召回（4 配置一致 0.865）

| 配置 | recall@1 | recall@3 | recall@5 | top-5 漏召回 |
|---|---|---|---|---|
| halfvec ON · L0 OFF | 0.081 | 0.730 | 0.865 | 5 题（Q26 / Q27 / Q32 / Q62 / Q70）|
| vector · L0 OFF | 0.081 | 0.730 | 0.865 | 同上 |
| **vector · L0 ON** | 0.081 | 0.730 | 0.865 | 同上 |
| halfvec ON · L0 ON | _未测_ | _未测_ | _预期同 0.865_ | _预期同_ |

**判读**：
- 本 change 的代码改动是**召回不变量**——三种已实测配置一律 0.865，没有任何一种比另一种坏。F3 硬约束应当读为"不让基线退步"而非"达成 1.000"。
- PROGRESS-SNAPSHOT-2026-04-26-l0-abstract 记录的 `recall@5=1.000` 在当前 corpus + eval 集 + flag 下**不可复现**，归 OQ-EVAL-RECALL-DRIFT 单独追查（属于 pre-existing drift，非本 change 引入）。
- halfvec 在当前 corpus 上的**唯一可观测局部副作用**：Q26 / Q32 retrieveInitial 候选从 5 切到 0（MIN_SCORE 阈值的 fp16 borderline 切线效应）。**对 recall@5 无影响**，但会让 LLM 失去 context；这是把 halfvec 默认翻 OFF 的关键依据之一（另一个是 30 MB 体量下 14 MB 节省不抵风险）。

---

## 三、关于"halfvec 默认 OFF"的最终决策（debrief）

ADR-44 D-003 已记录完整因果链。一句话总结：**halfvec 默认 OFF 不是因为它引发了 recall@5 的 1.000 → 0.865 跌落**——这个判读经实测推翻（halfvec rollback 后 recall 同样 0.865）。**默认 OFF 的真正理由是**：

1. halfvec 对 Q26/Q32 类 borderline 题有"5 候选 → 0 候选"的局部退化（fp16 在 4096-d cosine 上把 ~0.51 压到 ~0.49，跌过 MIN_SCORE=0.5）；
2. 当前 corpus ≤ 30 MB / 2k 行，halfvec 节省的 ~14 MB 不足以抵消任何风险。

OQ-VEC-QUANT-V2 已登记**重启前的硬前置条件**：必须先做 MIN_SCORE adaptive 或 reranker 兜底，才能再启 `PGVECTOR_HALF_PRECISION=true`。

---

## 四、未完成事项与 owner 接力

### 4.1 文件清理（用户机器手动一行）

```bash
cd /Users/xinyao/Git/knowledge-platform
rm -rf docs/superpowers/specs/pgvector-modernization
```

> 沙箱无 rm 权限，需要用户在本机执行。归档副本已落 `docs/superpowers/archive/asset-vector-coloc/design.md`，删除原 specs 目录后归档纪律完整。

### 4.2 单测旧红（与本 change 无关）

`pnpm -r test` 跑出 6 个 pre-existing 红：
- `qa.retrieve.test.ts`：vitest mock 提升问题（`Cannot access 'MockEmbeddingNotConfiguredError' before initialization`），是 vi.mock 与 const 声明顺序的 TDZ 老坑
- `abstract.generate.test.ts`：mock pool 期望 INSERT 1 行，实测 0 行
- `ingestRoutesAsync.test.ts`：PIPELINE_STEPS 长度期望 6 实测 7
- `ontology.routes.test.ts`：tag match 期望 3 实测 2
- `xlsxExtractor.test.ts` × 2：AST 空 fallback 路径期望与实测不一致

未做 `git stash` 验证是否 pre-existing；从模块依赖看与 pgDb 迁移 / Citation 透图 / halfvec 算子升级**无任何依赖关系**。建议作为单独 chore 起 C 类工作流（仿 ADR-43 `web-test-debt-cleanup` 的同款做法）。

### 4.3 README ↔ scripts 漂移（小坑）

README 写的 `pnpm dev:restart` 在 `package.json` 不存在，正确命令是 `pnpm dev:down && pnpm dev:up`。建议作为下一次 cleanup-day 顺手补 npm script。

---

## 五、链路完整性自检

| 工作流 Step | 产物 | 链路 |
|---|---|---|
| 1 Explore | `docs/superpowers/archive/asset-vector-coloc/design.md` | ✅ 引用 ADR-21-05 + ADR-39 |
| 2 Lock | `openspec/changes/asset-vector-coloc/{proposal,design,specs,tasks}.md` | ✅ proposal 与 spec 已同步 §"2026-04-27 修订"段（halfvec 默认 OFF + Item 2 单独保留） |
| 3 Execute | 代码 + 单测 + 回滚脚本 | ✅ tsc --noEmit 双 0；新 17 case 全绿 |
| 4 Archive | ADR-44 + 三条 OQ + integrations.md + 本 PROGRESS-SNAPSHOT | ✅ |

CLAUDE.md "OpenSpec 文件合并 = 接口契约生效" 纪律：本 change 的 OpenSpec 契约已稳定，下游可消费 `Citation.image_id` / `Citation.image_url` 两个新可选字段。

---

## Links

- ADR-44：`.superpowers-memory/decisions/2026-04-27-44-lance-borrowing-asset-vector-coloc.md`
- 上游 ADR-21-05：`.superpowers-memory/decisions/2026-04-21-05-q002-pgvector-source-of-truth-confirmed.md`
- 上游 ADR-39（同款方法论）：`.superpowers-memory/decisions/2026-04-24-39-weknora-borrowing-map.md`
- OpenSpec 活契约：`openspec/changes/asset-vector-coloc/`
- 归档 design：`docs/superpowers/archive/asset-vector-coloc/design.md`
- 三条 OQ：`.superpowers-memory/open-questions.md`（OQ-VEC-QUANT-V2 / OQ-CAPTION-DUAL-EMBED / OQ-EVAL-RECALL-DRIFT）
- 上一篇 PROGRESS：`.superpowers-memory/PROGRESS-SNAPSHOT-2026-04-26-l0-abstract.md`
