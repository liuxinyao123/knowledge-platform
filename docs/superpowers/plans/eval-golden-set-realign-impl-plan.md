# Impl Plan · eval-golden-set-realign

> 工作流 C。设计：`docs/superpowers/specs/eval-golden-set-realign-design.md`。

## 改动清单

### 1. Golden set 数据修复

- 扫描 `eval/gm-liftgate32-*.jsonl` 4 个文件
- `sed -E 's/"expected_asset_ids":[[:space:]]*\[3\]/"expected_asset_ids":[5]/g'` in-place（用 GNU sed 即可；macOS 上 `sed -i ''`）
- grep 校验：改前 `grep -c '"expected_asset_ids":\[3\]'` 应等于改后 `grep -c '"expected_asset_ids":\[5\]'` 的增量

### 2. `scripts/find-zombie-assets.mjs`

- 用 `pg` 库（项目已装），从 `infra/.env` / `apps/qa-service/.env` 读 `PG_*` 环境变量
- SQL：
  ```sql
  SELECT a.id, a.name, a.created_at,
         pg_size_pretty(pg_column_size(a.content)::bigint) AS content_size,
         (SELECT count(*) FROM metadata_field WHERE asset_id = a.id) AS chunks
    FROM metadata_asset a
   WHERE NOT EXISTS (SELECT 1 FROM metadata_field WHERE asset_id = a.id)
   ORDER BY a.created_at DESC;
  ```
- 输出：表格形式（asset id / name / created_at / size / chunks=0）
- `--delete` flag：列出后逐个询问，确认后调 `DELETE /api/knowledge/documents/:id`（走 ADR-30 的 audit）
- 默认不删，只 list

### 3. ADR-36

- 路径 `.superpowers-memory/decisions/2026-04-24-36-eval-golden-set-realign.md`
- 内容：现象 / 根因 / D-001~D-003 / 关联 ADR-30 / 关联 OQ-EVAL-1

### 4. open-questions 追加 OQ-EVAL-1

- `.superpowers-memory/open-questions.md` 加一条：是否给 eval-recall.mjs 加 PG 直连的 preflight 模式
- Owner / 等待事件 / 影响工作流 / 建议解决路径

### 5. PROGRESS-SNAPSHOT 追加

- `.superpowers-memory/PROGRESS-SNAPSHOT-2026-04-24-ontology.md` 末尾追加 §八 "Follow-up · eval-golden-set-realign（C 流程）"，记录验证结果

## 验证

- `node scripts/find-zombie-assets.mjs` 能跑通，列出当前 zombie（至少包含 id=3）
- 改 golden set 后 `grep -c "expected_asset_ids" eval/gm-liftgate32-*.jsonl` 总数不变
- 用户跑 `node scripts/eval-recall.mjs eval/gm-liftgate32-v2.jsonl` recall@5 显著回升（具体数字由用户记录）

## Out of Scope（推到后续）

- 给 eval-recall.mjs 加 preflight（OQ-EVAL-1）
- governance UI 加"僵尸资产"面板
- ingest 端的 idempotency 重设计
