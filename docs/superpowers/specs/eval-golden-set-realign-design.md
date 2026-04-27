# Explore · eval-golden-set-realign

> 工作流 C · `superpowers-feature-workflow`（无 OpenSpec，独立维护脚本 + 数据修复）。
> 上下文：2026-04-24 ontology 三件套验证后跑 `node scripts/eval-recall.mjs eval/gm-liftgate32-v2.jsonl` 0/37 命中。

## 现象

- `metadata_asset` 表里 `id=3 | name=LFTGATE-32_..._Rev.pdf | chunks=0`（僵尸记录）
- `id=5 | name=LFTGATE-32_..._Rev.pdf | chunks=1084`（同 PDF 重 ingest 后的真身）
- `id=4` 缺位（更早一次 ingest 被 DELETE 过）
- `eval/gm-liftgate32-v2.jsonl` 全 37 题 `expected_asset_ids:[3]`，永远召不到

## 根因

PostgreSQL `SERIAL` 序列**不回收已用 ID**。每次重 ingest（手动删 → 重传，或 ingest 端的 idempotency 走"先删后建"路径）都会拿到新 ID。`metadata_asset` 留下的旧行被 ON DELETE CASCADE 清掉了 chunks（参见 ADR-30 的 FK 设计），但行本身没被自动清理（因为 ADR-30 的 DELETE 端点要求显式调用）。

Golden set 是某次"清洁状态"下手工标注的 ID，跟 DB 状态会随时间漂移。当前没有任何机制告警这种漂移 → 跑 eval 的人会以为是 RAG 回归。

## 目标

1. **数据修复**：把 `gm-liftgate32-*.jsonl` 里所有 `expected_asset_ids:[3]` 改成 `[5]`，恢复 eval-recall 的可信度
2. **预防**：加 `scripts/find-zombie-assets.mjs` —— 一行命令列出所有 `chunks=0` 的 asset，帮 eval 维护人快速判断"是 ID 漂移还是 RAG 真退化"
3. **文档**：ADR 沉淀"SERIAL 不回收 + golden set 维护要点"，未来换人或换数据集都能避坑

## Out of Scope

- 改 ingest 路径让它复用已删 asset 的 ID（PG SERIAL 设计选择，不可强行）
- 自动清理僵尸记录的 cron job（应有 governance 模块兜，本次不重做）
- 改 `eval-recall.mjs` 自身做 DB preflight（脚本现在只走 HTTP API，加 PG 直连会引入新依赖；下次要做单独立项）

## 决策

| # | 决策 | 备注 |
|---|------|------|
| D-001 | 用 `sed -E -i` 直接改 golden set jsonl 文件 | 数据修复 in-place；旧文件 git diff 可追溯 |
| D-002 | 新增 `scripts/find-zombie-assets.mjs`，连 PG 直查 `LEFT JOIN metadata_field` 找 `chunks=0` 的 asset | 输出 `id / name / created_at / size_kb` 表格；`--delete` flag 可选触发 ADR-30 的 DELETE API（默认只查不删） |
| D-003 | ADR-36 记录"SERIAL 不回收 + 重 ingest 会拿到新 ID + golden set 必须人审" | 同时把 OQ-EVAL-1 加入 open-questions |

## 风险

| # | 风险 | 缓解 |
|---|------|------|
| R-1 | sed 改错把别的 `[3]` 也改了 | 用 anchor `"expected_asset_ids":\s*\[3\]` 严格匹配；改前后 grep 计数确认 |
| R-2 | `find-zombie-assets.mjs --delete` 误删活资产 | 默认不带 `--delete`；`--delete` 走 HTTP DELETE 端点（带审计），不走直接 SQL |
| R-3 | 4 个 jsonl（v2 / v3-annotated / v4-judge / 32-only）含相同模式 | sed 一次扫所有 `gm-liftgate32-*.jsonl`，单独 grep 校验 |
