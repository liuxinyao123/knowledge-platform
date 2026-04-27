#!/usr/bin/env bash
# scripts/cleanup-bad-chunks.sh
#
# rag-relevance-hygiene · D
# 清理 metadata_field (chunk_level=3) 里的脏数据：
#   - too_short        TRIM(content) 长度 < 20
#   - error_json_blob  顶层 JSON error body 被当正文存下来
#
# OCR 碎片判定（emoji / 单字符堆叠）PG regex 搞不定；走姐妹脚本：
#   node scripts/cleanup-bad-chunks-ocr.mjs
#
# 用法：
#   bash scripts/cleanup-bad-chunks.sh              # dry-run 只打印统计
#   bash scripts/cleanup-bad-chunks.sh --confirm    # 真实 DELETE
#
# 环境变量（同 cleanup-data.sh / permissions-v2-seed.sh）：
#   PG_CONTAINER=pg_db
#   PG_USER=knowledge
#   PG_DB=knowledge
#
# 退出码：0 = OK；非 0 = psql 出错
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-pg_db}"
PG_USER="${PG_USER:-knowledge}"
PG_DB="${PG_DB:-knowledge}"

MODE="dry-run"
if [[ "${1:-}" == "--confirm" ]]; then
  MODE="delete"
fi

c() { printf "\033[36m%s\033[0m\n" "$*"; }
g() { printf "\033[32m%s\033[0m\n" "$*"; }
y() { printf "\033[33m%s\033[0m\n" "$*"; }
r() { printf "\033[31m%s\033[0m\n" "$*" >&2; }

c "=============================================================="
c " Cleanup bad chunks (metadata_field, chunk_level=3)"
c "=============================================================="
c " PG: $PG_CONTAINER / $PG_USER / $PG_DB"
c " MODE: $MODE"
echo

# 1) 统计报告
c "▸ scanning..."
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 <<'SQL'
WITH classified AS (
  SELECT id, asset_id,
    CASE
      WHEN LENGTH(TRIM(content)) < 20 THEN 'too_short'
      WHEN TRIM(content) ~ '"type"\s*:\s*"error"|"error"\s*:\s*\{|not_found_error|File not found in container'
           AND TRIM(content) LIKE '{%'
        THEN 'error_json_blob'
      ELSE 'ok'
    END AS reason
  FROM metadata_field
  WHERE chunk_level = 3
)
SELECT reason, COUNT(*) AS rows, COUNT(DISTINCT asset_id) AS assets
FROM classified
WHERE reason <> 'ok'
GROUP BY reason
ORDER BY rows DESC;
SQL

if [[ "$MODE" != "delete" ]]; then
  echo
  y "(dry-run 模式；追加 --confirm 实际 DELETE；OCR 碎片走 cleanup-bad-chunks-ocr.mjs)"
  exit 0
fi

# 2) 实际 DELETE
echo
c "▸ deleting..."
DELETED=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At -v ON_ERROR_STOP=1 <<'SQL'
WITH del AS (
  DELETE FROM metadata_field
  WHERE chunk_level = 3
    AND (
      LENGTH(TRIM(content)) < 20
      OR (
        TRIM(content) LIKE '{%'
        AND TRIM(content) ~ '"type"\s*:\s*"error"|"error"\s*:\s*\{|not_found_error|File not found in container'
      )
    )
  RETURNING id
)
SELECT COUNT(*) FROM del;
SQL
)

g "✓ deleted $DELETED rows"
echo
y "提示：被删 chunk 的 embedding 也同步消失。受影响 asset 需要手动重跑 ingest："
y "   1. 在 /assets 找到对应 asset"
y "   2. 点击重新入库 / 或 POST /api/ingest/upload-full 重上传源文件"
y "   OCR 碎片类走: node scripts/cleanup-bad-chunks-ocr.mjs"
