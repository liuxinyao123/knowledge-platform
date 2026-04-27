# Ingest L0/L1 Abstract — 验收手册

> 配套 `openspec/changes/ingest-l0-abstract/` 与 ADR-32 候选。
> 跑过 6 个用例，把结论填到 ADR-32 末尾。

---

## 准备

确保 infra/.env 里有硅基 key（`EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL`）；`pnpm dev:up` 起栈。

默认配置：`L0_GENERATE_ENABLED=true` / `L0_FILTER_ENABLED=false` / `L0_LAZY_BACKFILL_ENABLED=false`。

---

## 用例 1 · 迁移幂等

```bash
pnpm dev:up   # 起栈，自动跑 runPgMigrations
pnpm dev:down
pnpm dev:up   # 再起一次，迁移幂等
```

预期：两次启动 `qa-service` 日志都不报错；`psql` 里 `\d chunk_abstract` 看到表与索引；`\d+ asset_abstract` 看到 view。

## 用例 2 · ingest 生成 L0/L1

前端上传一份正常 markdown / PDF（≥ 5 个 chunk）。

```sql
SELECT count(*) FROM chunk_abstract WHERE asset_id = <new_asset_id>;
```

预期：行数 > 0；`SELECT l0_text FROM chunk_abstract LIMIT 3` 看到合理中文一句话；qa-service 日志含 `event:abstract_done` JSON 行带 `generated/failed/skipped`。

## 用例 3 · disabled 时字节级一致

```bash
echo "L0_GENERATE_ENABLED=false" >> apps/qa-service/.env
pnpm dev:down && pnpm dev:up
# 上传同一份文档
```

预期：`chunk_abstract` 表无新增；`abstract_done` 日志计数全 0；ingest 时间不变。

## 用例 4 · L0 粗筛打开后召回不退化

```bash
# baseline
unset L0_FILTER_ENABLED
node scripts/eval-recall.mjs --dataset eval/gm-liftgate32-v2.jsonl --out /tmp/eval-baseline.json

# L0 粗筛打开
export L0_FILTER_ENABLED=true
pnpm dev:down && pnpm dev:up
node scripts/eval-recall.mjs --dataset eval/gm-liftgate32-v2.jsonl --out /tmp/eval-l0.json

diff <(jq '.summary' /tmp/eval-baseline.json) <(jq '.summary' /tmp/eval-l0.json)
```

预期：
- recall@10 退化 ≤ 3pp
- token 消耗（rerank+grade，看 trace）下降 ≥ 25%
- 失败任一指标 → 关 flag，本 change 状态置 Rejected

前端验证：发起一次 QA，SSE 流里看到 `🧰 L0 粗筛：N 个候选 asset` 一行；trace 里 `l0_filter_used: true` / `l0_candidate_count` 数值合理。

## 用例 5 · 降级（LLM key 失效）

```bash
# 临时把 EMBEDDING_API_KEY 改成无效字符串
export EMBEDDING_API_KEY=invalid
pnpm dev:down && pnpm dev:up

# 上传一份新文档
```

预期：ingest 完成（metadata_field 写入正常）；`abstract_done` 日志 `failed > 0`；前端 `/ingest` 进度条仍能走完到 100%。

发起一次 QA：表现回退到原路径，无 `🧰 L0 粗筛` 事件（embed 失败 coarseFilterByL0 返 undefined）。

## 用例 6 · active 回填脚本

准备：把 `chunk_abstract` 清空（仅本机调试）：`TRUNCATE chunk_abstract`。

```bash
# dry-run
node --experimental-strip-types scripts/backfill-l0.mjs

# 实跑 100 条
node --experimental-strip-types scripts/backfill-l0.mjs --commit --limit 100

# 断点续跑：先 ctrl-C，再跑同命令
```

预期：dry-run 输出预计行数，`chunk_abstract` 不变；`--commit --limit 100` 后 `chunk_abstract` 行数 = 100（假设全部成功）；ctrl-C 中断后 `.backfill-l0.cursor` 文件存在；再跑同命令从该 cursor 继续。

---

## 验收结论模板

```
date: 2026-04-XX
operator: <name>

[PASS/FAIL] 用例 1 迁移幂等
[PASS/FAIL] 用例 2 ingest 生成
[PASS/FAIL] 用例 3 disabled 字节级一致
[PASS/FAIL] 用例 4 L0 粗筛召回不退化（baseline=X, l0=Y）
[PASS/FAIL] 用例 5 降级
[PASS/FAIL] 用例 6 active 回填

最终：[PASS/FAIL]
后续：[合并 → ADR-32 Accepted / 关 flag → Rejected / ...]
```

把结论贴到 `.superpowers-memory/decisions/2026-04-26-32-ingest-l0-abstract.md` 末尾。

---
