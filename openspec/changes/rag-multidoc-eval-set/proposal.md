# Proposal: RAG 多文档类型评估集（D-003）

## Problem

`rag-intent-routing` change 的 V-3 实测（手动 7 case）暴露两个核心矛盾：

1. **手动实测覆盖率低**：每次代码改动都要人工跑 6-10 case 看 SSE 输出，无法
   量化跨文档类型的回归。
2. **现有 `eval/` 只评 recall@K**：`scripts/eval-recall.mjs` 跑 jsonl golden set
   仅算资产级召回率（"对的文档有没有进 top-K"），不评意图分类正确率、答案质量、
   language_op 输出格式、拒答率等档 B 引入的多维度。

V-3 已知 limitation（V3C / V3D）也是因为没有量化基线——不知道 limitation 影响面
有多大、改进后多少 case 能修。

D-002.2（kb_meta 路由 asset_catalog）和 D-002.3（language_op function tool）要
落地必须先有**多文档类型 + 多维度评估集**做回归基线，否则改完没法证明真修了。

## Scope（本 Change）

1. **新增评估集** `eval/multidoc-set.jsonl`（≥50 case，6 类文档 × 5 类意图覆盖）
2. **扩展 case schema**（向后兼容现有 `golden-set.template.jsonl`）：
   - 新字段：`doc_type` / `expected_intent` / `expected_pattern_type` /
     `expected_keywords` / `expected_must_not_contain` / `history` / `data_version`
   - 保留：`id` / `question` / `expected_asset_ids` / `expected_recall_top_k` / `comment`
3. **新增 eval runner** `scripts/eval-multidoc.mjs`：
   - 读 jsonl + 自动登录拿 token
   - 对每 case 跑 `POST /api/agent/dispatch`（含 history，跟生产路径一致）
   - 抽 SSE 事件流（`agent_selected` / `🎭` / `📊 trace.citations` / `content` 拼接）
   - 跑 7 类断言：intent / pattern_type / keywords / must_not_contain /
     recall@K / transparency_declaration / non_refusal_for_lang_op
   - 输出多维度报告（按维度 / 按 doc_type / 按 intent 分组 + failed 详情）
4. **跟现有 `scripts/eval-recall.mjs` 共存**——不动现有评测，互补不替换
5. **`eval/README.md` 增章节** 说明 D-003 多维度评测怎么跑

## Out of Scope（后续 Change）

- **LLM-as-judge 评分**：本 change 用规则断言保证确定性；judge 后续 D-005
- **CI 自动跑**：本 change 默认 manual；后续 D-006 加 `--sample N --strict`
- **multi-tenant case 隔离** / **跨语种**（日韩等）/ **多模态 case**

## 决策记录

| ID | 决策 | 替代方案 | 理由 |
|---|---|---|---|
| D-001 | 走 C-B 扩展现有 `eval/`（jsonl + runner 扩展） | C-A 全新框架（promptfoo / ragas）/ C-C eval-as-vitest | 改动 contained / 复用现有运维路径 / vitest 跑真 LLM 不友好 |
| D-002 | jsonl schema 加新字段而不是新格式 | 全新 yaml/json schema | 向后兼容 `golden-set.template.jsonl`；现有 case 加字段即可升级 |
| D-003 | 60 case 上限 | 100+ case | 跑一次 ~3 分钟可接受；超 60 维护成本陡增 |
| D-004 | doc_type 选 6 类（古文/英文 SOP/中文产品/表格/PPT/资讯）| 更多 / 更少 | 已入库现有数据决定；后续可扩 |
| D-005 | runner 用 Node.js（.mjs） | Python | 跟现有 `eval-recall.mjs` 一致 / 不引入新 runtime |
| D-006 | manual 跑（不进 CI）| CI 默认跑 | 真 LLM 调用 + 60 case ~3 分钟，CI 不友好；后续 D-006 可加 sample 模式 |
| D-007 | 规则断言（keywords + pattern_type）不引 LLM judge | LLM-as-judge 自动评分 | 保证确定性；judge 引入概率后置 D-005 |

## 接口契约（freeze 项）

详见 `specs/eval-case-schema-spec.md` / `specs/eval-runner-spec.md` /
`specs/intent-classifier-eval-spec.md` / `specs/answer-quality-eval-spec.md`。

下游消费者（合并后才能开始消费）：
- **D-002.2 kb_meta 路由**：开发后跑 `eval-multidoc.mjs` 看 kb_meta intent 通过率从 50% → ≥ 90%
- **D-002.3 language_op function tool**：跑同套，看 language_op 透明度声明覆盖率到 100%
- **未来 D-006 CI 集成**：复用 jsonl + runner，加 sample 选项