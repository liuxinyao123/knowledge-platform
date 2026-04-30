# Impl Plan · D-003 RAG 多文档类型评估集

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Execute（B-3）
> OpenSpec：`openspec/changes/rag-multidoc-eval-set/`
> Explore：`docs/superpowers/specs/rag-multidoc-eval-set/design.md`

## 已完成清单

| Task | 文件 | 改动 |
|---|---|---|
| BE-1/BE-2 | `scripts/eval-multidoc.mjs`（新建，~340 行） | 单文件 .mjs ESM；含 parseJsonl / login / dispatchSse / 7 assertion fn / 主流程；导出关键函数供后续测试 |
| BE-1 详细 | parseJsonl | 兼容 // 和 # 注释行；id/doc_type/question 必填校验；doc_type/expected_intent/expected_pattern_type 枚举校验 |
| BE-1 详细 | dispatchSse | 调 POST /api/agent/dispatch；解析 SSE 事件抽 Observed（topIntent/answerIntent/rewriteByCondense/shortCircuited/citations/answer/rawSseLines）；timeout 60s |
| BE-1 详细 | 7 assertion fn | assertIntent（含 short-circuit + 顶层错路由 + fallback 特例）/ assertPatternType（5 种模式各自 detector）/ assertKeywords / assertMustNotContain / assertRecallTopK / assertTransparencyDeclaration（仅 language_op）/ assertNonRefusalForLangOp（同样仅 language_op）|
| BE-1 主流程 | main() | preflight（jsonl 存在 + 解析 + 过滤）→ login → per-case dispatch + assertion → aggregate report（按维度 / doc_type / intent 三档）→ failed 详情 → must_pass + strict 退出码 |
| BE-2 CLI flags | --sample N / --doc-type X / --intent X / --strict / --verbose / [jsonl-path] | 全实现 |
| BE-2 env | EVAL_API / EVAL_ADMIN_EMAIL / EVAL_ADMIN_PASSWORD / EVAL_TIMEOUT_MS | 全实现 |
| DATA-1 | `eval/multidoc-set.jsonl`（新建，16 case 起步） | V-3 实测 7 case 转 jsonl + 各 doc_type 补 9 case；must_pass: V3A1/V3A2/case2a/V3B/V3E（5 条核心 case）|
| DATA 分布 | classical_chinese 6 / industrial_sop_en 5 / cn_product_doc 3 / short_news_md 1 / table_xlsx 1 | 4 个 expected_intent 覆盖（factual_lookup 5 / language_op 7 / kb_meta 2 / out_of_scope 2）|
| DATA-2~7 | 60 case 完整覆盖 | **本批 16 case 起步证 runner 可用 + 各意图能跑通；后续 manual 用真实数据扩到 60**（需要按你库内实际 asset_id 调整 expected_asset_ids）|
| BE-9 | 沙箱 inline smoke 26 断言 | parseJsonl 2 + assertIntent 5 + assertPatternType 6 + assertKeywords 4 + assertMustNotContain 2 + assertRecallTopK 2 + assertTransparencyDeclaration 3 + assertNonRefusalForLangOp 2，外加 bilingual 真实场景验证（cn 50% / ascii 34% pass）|
| BE-10 | tsc N/A（.mjs 无类型）| 改用 dry-run + smoke 验证 |
| DOC-1/2 | Explore design / OpenSpec 4 spec / tasks | B-1 / B-2 已写 |
| DOC-3 | 本文件 | B-3 倒推 |

## 待办（B-4 验证 · 用户在 macOS 跑）

| Task | 命令 | 期望 |
|---|---|---|
| V-1 / V-2 | 重启 qa-service（确保各 N-* 改动生效）→ `node scripts/eval-multidoc.mjs --sample 5` | 跑通 5 case，输出按维度/doc_type/intent 三档报告 |
| V-3 | `node scripts/eval-multidoc.mjs` | 全集 16 case ~3 分钟跑完，按维度通过率统计；must_pass 5 条 |
| V-4 | `node scripts/eval-multidoc.mjs --doc-type classical_chinese` | 仅 6 case，filter 生效 |
| V-5 | `node scripts/eval-multidoc.mjs --intent language_op` | 仅 7 case |
| V-6 | `node scripts/eval-multidoc.mjs --strict` | must_pass 任一 fail 退 1 |
| V-7 | `node scripts/eval-multidoc.mjs --verbose` | 每 case 打印答案前 120 字 + 失败维度 |

## 调整 expected_asset_ids（V-1 之前必须做）

`eval/multidoc-set.jsonl` 当前用占位 asset_id（[20]/[1,5]/[14,15]/[18]/[4]）。
**跑 V-1 之前必须把占位 ID 替换成你库里真实 asset_id**：

```bash
# 拿到真实 asset_id
TOKEN=$(curl -sS --noproxy '*' -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@dsclaw.local","password":"admin123"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

curl -sS --noproxy '*' http://localhost:3001/api/knowledge/documents \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c '
import json, sys
d = json.load(sys.stdin)
for i in d["items"]:
  print(f"  #{i[\"id\"]} {i[\"name\"]}")
'

# 然后 sed 替换 jsonl 里的占位 id（按文档名手动对照）
# 或者直接编辑 eval/multidoc-set.jsonl
```

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| asset_id 占位错 → recall 维度永远 fail | 预 V-1 必须先调 ID；调好之后真 asset 命中正常 |
| 16 case 不够覆盖 → 部分 doc_type 0/1 case 评估失败 | 起步可接受；后续按需扩 case |
| pattern_type 检测误判（如真实 bilingual 答案中文密度极高 → cn 80% / ascii 5% 不达标）| 阈值 20%/20% 是合理底线；若误伤，调成 15% 或加入 metric weighting |
| LLM 答案随机性 → flake | 同 case 多跑取均值；critical case 标 must_pass 严格盯 |
| 跑一次 ~3 分钟 | 默认 manual 跑；CI 可后续加 --sample 5 + --strict |

## 与 N-* + D-002.x 系列协同

- **D-002.2 kb_meta 路由 asset_catalog** 落地后跑本 eval：D003-V3D / D003-kbmeta-test 应当从"走 short-circuit 兜底"切到"正确分到 kb_meta + asset_list 输出"
- **D-002.3 language_op function tool** 落地后：D003-case2a / D003-V3B 等 language_op case 应当透明度声明 100% + 翻译质量提升
- **N-001 ~ N-006 任何 prompt 改动** 都跑本 eval 看是否回归

## Archive（B-4 验证通过后）
- [ ] AR-1：`docs/superpowers/specs/rag-multidoc-eval-set/` → `archive/`
- [ ] AR-2：看板 Done
- [ ] AR-3：合并 PR；jsonl schema + runner CLI freeze
- [ ] AR-4：通知下游：D-002.2 / D-002.3 / 后续任何 RAG 改动用 `eval-multidoc.mjs` 做回归基线
