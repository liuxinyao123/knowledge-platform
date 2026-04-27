#!/usr/bin/env bash
# scripts/cleanup-data.sh
#
# 数据清理脚本（范围 B：清空所有资产 / 笔记本 / 评测 + 磁盘图片）
#
# 删除：
#   PG: notebook* / eval_dataset* / metadata_asset* / metadata_field /
#       duplicate_dismissed / ingest_* 相关 audit_log
#   磁盘: infra/asset_images/* （PDF 抽取出来的图片）
#
# 保留：
#   PG: users / metadata_source / metadata_acl_rule / 非 ingest 的 audit_log
#       （也就是登录日志、ACL 操作日志这类历史保留）
#
# 用法：
#   bash scripts/cleanup-data.sh --confirm
#
# 安全锁：必须显式 --confirm，否则只 dry-run 打印将做什么
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

PG_CONTAINER=${PG_CONTAINER:-pg_db}
PG_USER=${PG_USER:-knowledge}
PG_DB=${PG_DB:-knowledge}

DRY_RUN=true
if [[ "${1:-}" == "--confirm" ]]; then
  DRY_RUN=false
fi

c() { printf "\033[36m%s\033[0m\n" "$*"; }
w() { printf "\033[33m%s\033[0m\n" "$*"; }
g() { printf "\033[32m%s\033[0m\n" "$*"; }
r() { printf "\033[31m%s\033[0m\n" "$*"; }

c "=============================================================="
c " 数据清理脚本 · 范围 B"
c "=============================================================="
c " PG 容器: $PG_CONTAINER  · 库: $PG_DB · 用户: $PG_USER"
c " 仓库根 : $REPO_ROOT"
echo

# 1. 当前数量统计
c "[Step 1/4] 当前数据量统计"
docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" <<'SQL'
SELECT
  (SELECT COUNT(*) FROM metadata_asset)              AS metadata_asset,
  (SELECT COUNT(*) FROM metadata_field)              AS metadata_field,
  (SELECT COUNT(*) FROM metadata_asset_image)        AS metadata_asset_image,
  (SELECT COUNT(*) FROM notebook)                    AS notebook,
  (SELECT COUNT(*) FROM notebook_chat_message)       AS notebook_message,
  (SELECT COUNT(*) FROM notebook_artifact)           AS notebook_artifact,
  (SELECT COUNT(*) FROM eval_dataset)                AS eval_dataset,
  (SELECT COUNT(*) FROM eval_run)                    AS eval_run,
  (SELECT COUNT(*) FROM eval_case_result)            AS eval_case_result,
  (SELECT COUNT(*) FROM duplicate_dismissed)         AS duplicate_dismissed,
  (SELECT COUNT(*) FROM audit_log WHERE action ILIKE 'ingest%' OR action = 'asset_register' OR action = 'bookstack_page_create') AS ingest_audit_rows,
  (SELECT COUNT(*) FROM users)                       AS users_kept,
  (SELECT COUNT(*) FROM metadata_source)             AS sources_kept,
  (SELECT COUNT(*) FROM metadata_acl_rule)           AS acl_rules_kept;
SQL
echo

# 2. 磁盘统计
c "[Step 2/4] 磁盘 infra/asset_images/ 统计"
if [[ -d "$REPO_ROOT/infra/asset_images" ]]; then
  IMG_COUNT=$(find "$REPO_ROOT/infra/asset_images" -type f 2>/dev/null | wc -l | tr -d ' ')
  IMG_SIZE=$(du -sh "$REPO_ROOT/infra/asset_images" 2>/dev/null | cut -f1)
  echo "  文件数: $IMG_COUNT"
  echo "  总大小: $IMG_SIZE"
else
  echo "  (目录不存在，跳过)"
fi
echo

# 3. 决策点
if $DRY_RUN; then
  w "[DRY RUN] 没加 --confirm，啥都不会删。要真删请跑："
  echo "          bash scripts/cleanup-data.sh --confirm"
  exit 0
fi

w "[Step 3/4] ⚠️  3 秒后开始执行删除（Ctrl+C 取消）..."
sleep 3

# 4. 执行 SQL 删除
c "[Step 4/4] 执行删除"
docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" <<'SQL'
BEGIN;

-- 4.1 笔记本（级联删 source / message / artifact）
DELETE FROM notebook;

-- 4.2 评测（级联删 case / run / case_result）
DELETE FROM eval_dataset;

-- 4.3 资产 / chunk / 图片元数据
DELETE FROM metadata_asset;       -- 级联 metadata_field, metadata_asset_image

-- 4.4 重复判断记录
DELETE FROM duplicate_dismissed;

-- 4.5 ingest 相关 audit（保留 login/logout 等历史）
DELETE FROM audit_log
WHERE action ILIKE 'ingest%'
   OR action = 'asset_register'
   OR action = 'bookstack_page_create';

-- 4.6 重置 id 序列从 1 开始（下次 ingest 心情好）
ALTER SEQUENCE metadata_asset_id_seq         RESTART WITH 1;
ALTER SEQUENCE metadata_field_id_seq         RESTART WITH 1;
ALTER SEQUENCE metadata_asset_image_id_seq   RESTART WITH 1;
ALTER SEQUENCE notebook_id_seq               RESTART WITH 1;
ALTER SEQUENCE notebook_chat_message_id_seq  RESTART WITH 1;
ALTER SEQUENCE notebook_artifact_id_seq      RESTART WITH 1;
ALTER SEQUENCE eval_dataset_id_seq           RESTART WITH 1;
ALTER SEQUENCE eval_case_id_seq              RESTART WITH 1;
ALTER SEQUENCE eval_run_id_seq               RESTART WITH 1;
ALTER SEQUENCE eval_case_result_id_seq       RESTART WITH 1;

COMMIT;

-- 验证
SELECT
  (SELECT COUNT(*) FROM metadata_asset)        AS asset_left,
  (SELECT COUNT(*) FROM notebook)              AS notebook_left,
  (SELECT COUNT(*) FROM eval_dataset)          AS eval_left,
  (SELECT COUNT(*) FROM users)                 AS users_kept,
  (SELECT COUNT(*) FROM metadata_source)       AS sources_kept;
SQL
echo

# 5. 磁盘清理
c "[Step 5/5] 清理磁盘 infra/asset_images/"
if [[ -d "$REPO_ROOT/infra/asset_images" ]]; then
  # 安全：只删该目录"内部"的内容；不删目录本身
  find "$REPO_ROOT/infra/asset_images" -mindepth 1 -delete
  REMAIN=$(find "$REPO_ROOT/infra/asset_images" -type f 2>/dev/null | wc -l | tr -d ' ')
  g "  ✓ 已清空。剩余文件数: $REMAIN"
else
  echo "  (目录不存在，跳过)"
fi

echo
g "✓ 清理完成。"
g "  现在可以重新 ingest 了。第一个 asset 的 id 会是 1。"
g "  如果你之前在 notebook 里 / eval 里引用过 asset_id，也都没了，记得一并重建。"
