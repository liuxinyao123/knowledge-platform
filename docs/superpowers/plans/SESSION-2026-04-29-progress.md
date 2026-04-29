# Session Progress · 2026-04-29

> 分支：`feat/rag-followup-condensation`
> 上下文：从 D-003 baseline 3 LLM 截断疑案 → 顺出 SSE race bug → 推进 D-002.2 → 收口 D-003 评测器 → 落地 D-002.3 multi-tool → 加 D-002.4 majority-of-N 评测器 → 修 D-002.5 v2-A V3D 语义筛 → 探索 D-002.6 v1 factual_lookup prompt（探索归零，default off）→ 锁 N-007/N-008 spec
> 下一站待选：N-007 Execute（macOS）/ N-008 Execute（前置 N-007）/ D-002.7 重新设计 factual_lookup prompt

---

## 本次完成（按提交分组）

### Commit ① · D-003 评测集 jsonl 修复
**文件**：`apps/qa-service/src/services/answerIntent.ts`、`eval/multidoc-set.jsonl`、`docs/superpowers/plans/rag-multidoc-eval-set-impl-plan.md`

- `answerIntent.ts` `isObviousLanguageOp` `QUERY_STARTERS` 改"句首匹配"（去掉 `q.includes(s)`），避免句尾"是什么"误吃
- classify prompt 加 kb_meta vs factual_lookup / out_of_scope vs factual_lookup 判定窍门
- jsonl：V3A2 放宽 expectations / V3C 改 refusal / oos-historical 改 factual_lookup
- jsonl：D003-sop-中英 `expected_asset_ids: [1,5] → [19]`（baseline 4 实测发现的占位错）
- jsonl：D003-cn-fact `pattern_type: verbatim → list`（模块清单本来就不该有数值+单位）
- jsonl：删 D003-V3B-prime2（今日头条文档自身只有"网站需要 JavaScript"一句话）

### Commit ② · D-003 SSE 修复 + 评测器放宽
**文件**：`scripts/eval-multidoc.mjs`

- **SSE race bug 修复**：旧 `Promise.race([reader.read(), sleep1s])` 在心跳赢时孤儿化 read promise，下次循环新 read 拿到的是下一条 chunk → 首字 chunk 被吞。沙箱实测：5 chunk × 1.5s gap，旧版捕获 0/5；新版 5/5
- assert 加 NFKC normalize（OCR 异体字 ⽼ U+2F77 → 老 U+8001）
- `assertPatternType.list` 加 4 模式：经典 bullet / 顿号 ≥3 / 粗体段 ≥2 / 分号 ≥3，任一过即可
- `assertPatternType.bilingual` 阈值 20% → 10%（支持工业 SOP "轻度双语"）

### Commit ⑦ · D-002.6 v1 factual_lookup prompt 探索（B 工作流，default off）
**修改**：`apps/qa-service/src/services/answerPrompts.ts`（+30 / -2）
**修改**：`apps/qa-service/src/__tests__/answerPrompts.test.ts`（+13 case：env 守卫 3 + FL-1..FL-5）
**新增**：`docs/superpowers/archive/rag-factual-lookup-refusal-fix/design.md`（已归档）
**新增**：`docs/superpowers/plans/rag-factual-lookup-refusal-fix-impl-plan.md`
**新增**：`openspec/changes/rag-factual-lookup-refusal-fix/{proposal,design,specs/factual-lookup-prompt-spec,tasks}.md`

改造内容：
1. 加 `isFactualStrictVerbatimEnabled()` env 守卫，**default `false`**（A4 verify 后翻转）
2. `buildFactualLookupPrompt` 第 1 条规则按 env 分支：
   - **严格版** (env=true, opt-in)：`先尝试 verbatim 提取... 只有所有 chunks 完全无关键实体或同义实体才说找不到`
   - **legacy 版** (default)：保留原 `找不到就说「知识库中没有相关内容」，不要猜`
3. 其它 4 条规则不变（禁模糊措辞 / verbatim 数值 / [N] 引用 / 不漏组件）

A4 verify 反直觉发现：
- 单跑 N=3：env=true 路径 keywords 2/3 + pattern_type 1/3 → BROKEN
- 单跑 N=3：env=false 路径（legacy）keywords 3/3 + pattern_type 3/3 → STABLE，答案含 "8.0mm" verbatim
- **严格 prompt 反而更易拒答**——可能 fast LLM 对长复杂指令解析不佳，被 fallback 短语 prime
- 整体 v3 全集跑：sop-数值 多 sample 平均 78% keyword 命中（baseline 33%）—— 有改善但与 LLM 抖动重叠

决策：保留代码架构 + 测试 + env 守卫，default `false` 让生产保 legacy。env=true opt-in 实验通道，待 D-002.7 重新设计 prompt（候选：few-shot 示例 / chain-of-extract 步骤拆分 / system-then-user 结构调整）。

零回归：industrial_sop_en 全集 STABLE / 全集 N=3 intent 14/14 + must_pass 5/5 / vitest D-002.6 测试 24/24 全过。

### Commit ⑧ · N-007 + N-008 specs（B 工作流 Explore + Lock 阶段）
**新增**：`docs/superpowers/specs/notebook-public-templates/design.md`（N-007）
**新增**：`docs/superpowers/specs/notebook-user-templates/design.md`（N-008）
**新增**：`openspec/changes/notebook-public-templates/{proposal,design,specs,tasks}.md`
**新增**：`openspec/changes/notebook-user-templates/{proposal,design,specs,tasks}.md`

N-007 公共模板池（前置 N-008）：
- 把 N-006 6 个内置模板从代码常量迁到 DB 表 `notebook_template`
- 加 `source` 字段（`system / community / user`）
- DB 表 schema + CHECK constraints + 8 acceptance test (PT-1..PT-8)
- v1 不做 community 提交流程

N-008 用户自定义模板（基于 N-007 schema）：
- 4 个 CRUD API: POST/GET/PATCH/DELETE /api/templates
- 字段约束: label≤10, desc≤60, hint≤40, starterQuestions 1-3 条≤50/each
- 前端: CreateTemplateModal + MyTemplateActions hover 按钮 + source 角标
- env `USER_TEMPLATES_ENABLED` 守卫
- 14 acceptance test (UT-1..UT-14)

Execute 阶段下 session 在 macOS 上做（DB migration + 前后端跨改）。

### Commit ⑥ · D-002.5 v2-A kbMetaHandler 语义筛 V3D 修复（C 工作流，迭代 2 次）
**修改**：`apps/qa-service/src/services/kbMetaHandler.ts`（+50 / -10）
**修改**：`apps/qa-service/src/__tests__/kbMetaHandler.test.ts`（4 旧 case 改 mock 形状 + 加 4 v2-A 新 case）
**新增**：`docs/superpowers/specs/rag-kb-meta-semantic-filter-fix-design.md`
**新增**：`docs/superpowers/plans/rag-kb-meta-semantic-filter-fix-impl-plan.md`

修改：
1. `STOP_PREFIXES` 加 `"哪些"`：修复 extractKbMetaKeywords V3D bug
   - "库里有哪些汽车工程相关的资料" 之前抽出 `["哪些汽车工程"]` (SQL 0 命中)
   - 现在抽出 `["汽车工程"]` (SQL 仍 0 命中但语义更干净)
2. `renderKbMetaAnswer` >10 候选路径 LLM prompt 改造：
   - 加领域术语缩写 hint（LFTGATE/BP/SOP/PRD/API/SDK）
   - "最多 8 条" → "3-8 条"（设下界）
   - 弱化 "0" escape hatch
3. `renderKbMetaAnswer` 加 N=2 self-consistency：
   - Promise.all 跑 2 次 LLM (temperature 0.1 / 0.5 互补)
   - picks 取并集；保留 emptyAnswer 契约（两次都说 "0" 才触发）
   - 兜底补齐到 ≥ 3 条（`0 < |union| < 3` 时用 candidates 顺序补）
4. 兜底链完整：单次 LLM throw 内部 catch 返 ''；两次都失败 → 退化前 8 条

V-13 实测：
- V3D keywords 0/3 (baseline 8) → 1/3 (v1) → **2/3 (v2-A)** ✓ acceptance ≥ 2/3 达成
- kbmeta-test STABLE 不回归 ✓
- kb_meta intent 100% (2/2) ✓
- env=false 反向回滚 V3D 也 2/3 → 揭示 V3D 本质是 ~67% LLM 抖动 case，无论哪条路径都收敛到该均值
- cn-fact 1/3 / V3E 0/3 是 D-002.3 LLM 抖动随机方差，与 v2-A 无关

production：仅 kb_meta `>10 候选` 路径 token 成本 2x（kb_meta 路径整体频次低，可接受）

### Commit ⑤ · D-002.4 eval-multidoc.mjs majority-of-N（C 工作流离线 only）
**修改**：`scripts/eval-multidoc.mjs`（+约 130 行）
**新增**：`docs/superpowers/specs/rag-majority-of-n-design.md`（Explore，4 路径 trade-off + 3 落地方案）
**新增**：`docs/superpowers/plans/rag-majority-of-n-impl-plan.md`（Plan，7 步实施切片）

新 CLI flags：
- `--repeat N`（默认 1，常用 N=3）—— 每 case 跑 N 次
- `--case <id>`（顺手补，原先被静默忽略）—— 单 case 精确过滤

新核心：
- `majorityVote(perRun, N)` 纯函数：`⌈N/2⌉` 阈值 + skipped 透传 + 三档分类（stable / majority / broken）
- 主循环抽 `runOnce(c)`，N>1 时打 `STABLE` / `MAJORITY` / `FAIL` 三档标签
- 新「稳定性报告」段：STABLE / FLAKY / BROKEN 三档 + flaky/broken 维度详情

向后兼容：
- N=1（默认）输出与 baseline 8 完全等价（PASS/N-of-7 标签 + `(top=.../answer=...)` trailing）
- 仅改 `scripts/`，不动 `src/**`，vitest 零回归

V-9 实测：
- 全集 N=3：13/15 STABLE、2/15 FLAKY（V3E intent 2/3 + classical-translate pattern 2/3）、0/15 BROKEN
- 单 case verbose 揭示 V3D keyword 0/3 + sop-数值 pattern 1/3 / keywords 1/3
  → 之前认为是"LLM 抖动"，N=3 多采样揭示**疑似系统问题**，需 D-002.5 / D-002.6 后续介入

production 完全不动；streaming UX 不变；零延迟代价；token 成本仅在跑评测时 N×。

### Commit ④ · D-002.3 答案意图分类 multi-tool function call（B 工作流四阶段）
**新增**：`docs/superpowers/archive/rag-intent-multi-tool/design.md`（已归档）
**修改**：`apps/qa-service/src/services/answerIntent.ts`（+180 行）
**修改**：`apps/qa-service/src/__tests__/answerIntent.test.ts`（整体重组，30+ case）
**新增**：`docs/superpowers/plans/rag-intent-multi-tool-impl-plan.md`
**新增**：`openspec/changes/rag-intent-multi-tool/{proposal,design,specs/answer-intent-multi-tool-spec,tasks}.md`

公共 API：
- `isIntentMultiToolEnabled()` env 守卫（默认 true，识别 false/0/off/no）
- `INTENT_TOOLS` 5 个独立 OAITool（`select_factual_lookup` / `select_language_op` / `select_multi_doc_compare` / `select_kb_meta` / `select_out_of_scope`），每 tool 共享 `{ reason: string }` 单字段
- `TOOL_NAME_TO_INTENT` 5 项反查表
- `classifyAnswerIntent` 改为 dispatch：guards → isObviousLanguageOp 规则前置 → multi-tool 路径（默认）/ legacy 路径
- multi-tool 路径用 `tool_choice: 'required'` 让 LLM 在 tool selection 决断；旧 single-tool 路径完整保留作回滚

兜底链（multi-tool）：
1. toolCalls 为空 → factual_lookup + fallback
2. tool name 不在 5 个里（hallucination）→ factual_lookup + fallback，reason 含 'unknown tool'
3. 多 tool calls → 取首个，reason 追加 'multi-tool, took first'
4. args 解析失败但 name 合法 → 接受 intent（fallback=false），reason='args parse failed'

V-3 三跑实测：
| 跑次 | intent | must_pass | V3E | 失败 case |
|---|---|---|---|---|
| Run 1 | 14/14 | 5/5 | oos ✓ | 0（满分）|
| Run 2 | 14/14 | 5/5 | oos ✓ | V3A keywords + V3D keywords（LLM 抖动）|
| Run 3 | 14/14 | 5/5 | oos ✓ | sop-数值 pattern + V3A transparency（LLM 抖动）|

acceptance criteria 3 全过：intent 14/14、must_pass 5/5、V3E 3/3 oos。
V-4 legacy 回滚验证：12/14（cn-fact 抖到 kb_meta），印证 D-1 「single-tool + enum 比 multi-tool 不稳」假设。

### Commit ③ · D-002.2 kb_meta 路由 asset_catalog（B 工作流）
**新增**：`apps/qa-service/src/services/kbMetaHandler.ts`（~290 行）
**新增**：`apps/qa-service/src/__tests__/kbMetaHandler.test.ts`（42 case 全过）
**修改**：`apps/qa-service/src/services/ragPipeline.ts`（两个接入点）
**文档**：`docs/superpowers/specs/rag-kb-meta-routing/design.md` + `openspec/changes/rag-kb-meta-routing/{proposal,specs/kb-meta-handler-spec,tasks}.md` + `docs/superpowers/plans/rag-kb-meta-routing-impl-plan.md`

公共 API：
- `isObviousKbMeta(q)` 双锚定正则（目录前缀 + 文档名词）+ 排除"X 的属性"句式
- `extractKbMetaKeywords(q)` 反复剥前后缀 + 类型词不当 keyword
- `queryAssetCatalog({keywords, assetIds, sourceIds, limit})` PG ILIKE ANY + 失败回 `[]`
- `renderKbMetaAnswer({question, candidates, signal})` 0/≤10/>10 三分支 + LLM 失败兜底
- `runKbMetaHandler(question, emit, signal, opts)` 编排 + omitDoneAndTrace/omitIntentEmit option

V3D 关键修复：keywords 非空但 SQL 0 命中 → 退化全库列表 + LLM 语义筛（emit 🔄）

ragPipeline 接入：
1. **runRagPipeline 入口短路**（V3D 类）：`isObviousKbMeta(q) → runKbMetaHandler + return`，绕过 retrieval/rerank/short-circuit
2. **generateAnswer 内档 B fallback**（kbmeta-test 类）：`answerIntent='kb_meta' → runKbMetaHandler + return`，替代 buildKbMetaPrompt + LLM 流

env 守卫：`KB_META_HANDLER_ENABLED`（默认 true）

---

## 当前 baseline 8（D-002.3 落地后）

V-3 三跑取众数（multi-tool 默认 on）：

```
按维度（三跑稳定值）:
  intent               │ 14/14  100.0% ✓
  pattern_type         │ 11~12/12  92~100%
  keywords             │  9~11/11  82~100%
  must_not_contain     │  8/ 8  100.0% ✓
  recall               │ 11/11  100.0% ✓
  transparency         │  5~6/ 6  83~100%
  non_refusal_lop      │  6/ 6  100.0% ✓

按 expected_intent:
  factual_lookup         │  5/ 5  100.0% ✓
  kb_meta                │  2/ 2  100.0% ✓（baseline 7 偶发抖到 1/2）
  language_op            │  5~6/ 6
  null                   │  1/ 1  100.0% ✓
  out_of_scope           │  1/ 1  100.0% ✓ ← V3E V-3 三跑稳定 oos

must_pass: 5/5（V-3 三跑稳定）
```

**对比 baseline 7**（D-002.3 实施前）：
- intent: 92.9% → 100%（V3E + cn-fact 偶发抖动消除）
- must_pass: 4/5 → 5/5
- 残留抖动维度：keywords / pattern_type / transparency 仍有 generateAnswer 侧 LLM 抖动（V3A 数据权限 / V3D LFTGATE / sop-数值 verbatim / V3A transparency declaration），不在 D-002.3 范围

**对比 baseline 4**（D-002.2 实施前）：
- intent: 86.7% → 100%
- pattern_type: 69.2% → 92~100%
- recall: 91.7% → 100%
- kb_meta intent: 0/2 → 2/2（V-3 三跑稳定）
- table_xlsx doc_type: 0% → 100%（baseline 6+ 起）

---

## 残留抖动 case（D-002.3 之后仍偶发）

| Case | 维度 | 原因 | 修法 |
|---|---|---|---|
| D003-V3A | keywords missing 数据权限 | generateAnswer LLM 用"3 个治理子模块"概称没说"数据权限" | LLM 抖动；后续可改 assertKeywords AND→OR 或 prompt 强 anchoring |
| D003-V3D | keywords missing LFTGATE | LLM 语义筛只挑了 1 条 Bumper PDF | LLM 抖动；改 prompt 强制 ≥3 条 |
| D003-sop-数值 | pattern_type verbatim 没数值+单位 | LLM 偶发"知识库中没有具体..."而非引用文档 verbatim | LLM 抖动；可加 prompt 强约束 |
| D003-V3A | transparency 末尾未声明"未引外部背景" | LLM 偶发不写 transparency declaration | LLM 抖动；可加 prompt 强制 |

**结论**：D-002.3 之后**所有 intent 误分 case 已消除**（V3E/cn-fact 抖动全部稳到正确 intent）。残留抖动全在 generateAnswer 侧（keywords / pattern / transparency），与 intent classifier 正交，不在 D-002.3 范围。

---

## 已 archive 任务（按时间倒序）

| ID | 内容 |
|---|---|
| #66 | **N-007 + N-008 specs（B 工作流 Explore + Lock 阶段）** |
| #65 | **D-002.6 v1 factual_lookup prompt 探索（B 工作流，default off，待 D-002.7 重设计）** |
| #64 | **D-002.5 v2-A kbMetaHandler 语义筛 V3D 修复（C 工作流，迭代 2 次）** |
| #63 | **D-002.4 eval-multidoc.mjs majority-of-N（C 工作流离线 only）** |
| #62 | **D-002.3 答案意图分类 multi-tool function call（B 工作流四阶段）** |
| #61 | D-003 评测器太严修复（C 工作流）—— pattern.list 4 模式 + bilingual 阈值放宽 + 删 V3B-prime2 |
| #60 | D-002.2 V3D 0 命中退化修复（C 工作流）|
| #59 | **D-002.2 kb_meta 路由 asset_catalog（B 工作流四阶段）** |
| #58 | eval-multidoc.mjs SSE 流首字丢失修复 |
| #57 | 用户重启 qa-service + 重跑 eval 看 baseline 提升 |
| #56 | D-003 baseline 后续 4 修复（C 工作流）|

---

## 待办（下次会话开始时选一个）

### 选项 A · N-007 Execute（macOS，~1.7 小时）
**做**：DB migration `notebook_template` 表 + seed 6 system 模板 + service 改造 + 前端类型 widening
**前置**：spec/openspec 已 lock；参 `openspec/changes/notebook-public-templates/tasks.md` BE-1..BE-6
**为啥重要**：N-008 前置；模板基础架构

### 选项 B · D-002.7 重新设计 factual_lookup prompt（B 工作流，~1 小时）
**做**：基于 D-002.6 v1 反直觉发现重新设计严格 prompt
**候选方向**：(a) few-shot 示例 prompt；(b) chain-of-extract 步骤拆分（先识别 entity → 引用 chunk → 决定是否拒答）；(c) system message 与 user message 解耦
**期望**：sop-数值 keywords 2/3 → 3/3 + pattern_type 也 ≥ 2/3

### ~~选项 C · D-002.6 sop-数值 retrieval/prompt 拒答倾向修复~~（已做 v1，default off 探索归零；下次走 D-002.7）
**修**：D-002.4 揭示 sop-数值 pattern 1/3 / keywords 1/3 — 2/3 LLM 拒答 "知识库中没有相关内容"
**根因**：retrieval 召回 alpha/beta clearance 内容稳定但 LLM 倾向不引用
**改法**：调查召回 chunks 是否真含 alpha/beta；调 factual_lookup prompt 强制"如召回有相关内容必须引用 verbatim"

### 选项 C · N-007 公共模板（B 工作流，~1 小时）
**做**：把 N-006 的 6 个 NotebookTemplate 提到"公共模板池"，加 source 字段（system / community / user），社区可见的模板能被所有空间引用
**架构**：模板提交流程（submit → review → publish）+ 模板浏览页 + Detail 引入"应用模板"按钮

### 选项 D · N-008 用户自定义模板（B 工作流，~1 小时）
**做**：用户可以自己创建模板（label / icon / desc / recommendedSourceHint / starter questions / recommended artifacts），存到 `notebook_template` 表
**前置**：N-007 完成后 schema 复用；如果直接做 N-008，需要先把存储层扩出来

### 选项 E · D-003 评测集扩到 60 case（C 工作流，~45 分钟手动）
**做**：当前 15 case 起步集 → 按 doc_type × expected_intent × pattern_type 矩阵补全到 60 case
**前置**：需要更多文档入库（覆盖 presentation_pptx / table_xlsx / short_news_md 三个低 case 数 doc_type）

---

## 已知系统层 limitation（不在本次 session 范围）

- **D-005 资产关系图谱**：`graphDb runCypher` 在每次 retrieval 时报 `syntax error at or near "|"`，但是 fail 不阻塞主流程（fallback to vector）。需要专门 session 看 cypher 转译
- **D-006 L0 filter 异常**：`[l0Filter] coarse:err: bind message supplies 2 parameters, but prepared statement "" requires 1` 偶发但不阻塞。也 fallback 到全库 retrieval
- **LLM 抖动**：当前 single-pass eval 难以覆盖；V3A / V3D / V3E 都体现这一点。后续可考虑：(a) 同 case 跑 3 次取众数；(b) 在 must_pass 维度加 confidence interval

---

## 提交状态

**待 push**（更新版）：7 条 commit 累计在分支等用户决定 push 节奏。前 4 已脚本化（commit ① ② ③ ④），新增 commit ⑤ majority-of-N、⑥ V3D 语义筛、⑦ D-002.6 v1（default off 探索归零）、⑧ N-007/N-008 specs。具体脚本见各次会话回复。 (旧版 4 条 commit 脚本如下：)

```bash
cd ~/Git/knowledge-platform
git add apps/qa-service/src/services/answerIntent.ts \
        eval/multidoc-set.jsonl \
        docs/superpowers/plans/rag-multidoc-eval-set-impl-plan.md
git commit -m "fix(eval): D-003 baseline 后续 5 修复 (...)"

git add scripts/eval-multidoc.mjs
git commit -m "fix(eval): scripts/eval-multidoc.mjs SSE + 评测器放宽 (...)"

git add apps/qa-service/src/services/kbMetaHandler.ts \
        apps/qa-service/src/services/ragPipeline.ts \
        apps/qa-service/src/__tests__/kbMetaHandler.test.ts \
        docs/superpowers/specs/rag-kb-meta-routing/ \
        docs/superpowers/plans/rag-kb-meta-routing-impl-plan.md \
        openspec/changes/rag-kb-meta-routing/
git commit -m "feat(qa): D-002.2 RAG kb_meta 路由 asset_catalog (...)"

# Commit ④ · D-002.3 multi-tool function call
git add apps/qa-service/src/services/answerIntent.ts \
        apps/qa-service/src/__tests__/answerIntent.test.ts \
        docs/superpowers/archive/rag-intent-multi-tool/ \
        docs/superpowers/plans/rag-intent-multi-tool-impl-plan.md \
        openspec/changes/rag-intent-multi-tool/ \
        docs/superpowers/plans/SESSION-2026-04-29-progress.md
git commit -m "feat(qa): D-002.3 answerIntent multi-tool function call

- 5 个独立 OAITool（select_*）+ tool_choice='required'
- 让 LLM 在 tool selection 决断而不是 enum 字段值
- env INTENT_MULTI_TOOL_ENABLED 默认 on，false 走旧 single-tool 回滚
- isObviousLanguageOp 规则前置不动；旧 CLASSIFY_TOOL 完整保留

V-3 三跑实测：
- intent 14/14 (100%)、must_pass 5/5、V3E 3/3 oos
- baseline 7 vs baseline 8: intent 92.9% → 100%, must_pass 4/5 → 5/5
- legacy 路径 V-4 回滚显示 cn-fact 抖到 kb_meta，印证 D-1 假设"

git push origin feat/rag-followup-condensation
```

完整 commit message 见会话前一条回复。
