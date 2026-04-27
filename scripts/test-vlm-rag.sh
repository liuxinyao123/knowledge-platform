#!/usr/bin/env bash
# test-vlm-rag.sh — 一键验证 VLM + RAG 链路
# 流程：
#   1. 开 INGEST_VLM_ENABLED
#   2. 重启 qa-service
#   3. 上传指定 PDF
#   4. 等待 ingest 完成
#   5. 验 metadata_asset_image.caption 写入
#   6. 打一个问题 /api/qa/ask，看 citations 是否命中
#
# 用法：./scripts/test-vlm-rag.sh <PDF 绝对路径> "<可选问题>"

set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PDF="${1:-}"
QUESTION="${2:-这份文档讲了什么}"

if [ -z "$PDF" ] || [ ! -f "$PDF" ]; then
  echo "Usage: $0 <PDF 绝对路径> [问题]"
  echo "Example: $0 /Users/xinyao/Downloads/Bumper\\ Integration\\ BP\\ rev\\ 11.pdf '什么是 push-up 方向'"
  exit 1
fi

cyan()  { printf "\033[36m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }

ENV_FILE="apps/qa-service/.env"

cyan "[1/6] 确保 INGEST_VLM_ENABLED=true"
if grep -qE '^INGEST_VLM_ENABLED=' "$ENV_FILE"; then
  sed -i '' 's/^INGEST_VLM_ENABLED=.*/INGEST_VLM_ENABLED=true/' "$ENV_FILE"
else
  echo 'INGEST_VLM_ENABLED=true' >> "$ENV_FILE"
fi
grep -E '^INGEST_VLM_(ENABLED|MODEL|CONCURRENCY)=' "$ENV_FILE" || true

cyan "[2/6] 重启 qa-service"
pnpm dev:down >/dev/null 2>&1 || true
pnpm dev:up >/dev/null
sleep 3
: > .dev-logs/qa-service.log

cyan "[3/6] 上传 PDF（含 VLM 调用，约 1-3 分钟）"
RESP=$(curl --noproxy "*" -s --max-time 600 -X POST http://127.0.0.1:3001/api/knowledge/ingest \
  -F "file=@${PDF}" -F source_id=1)
echo "$RESP" | python3 -m json.tool

ASSET_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['assetId'])")
green "assetId = $ASSET_ID"

cyan "[4/6] 看落档图片数"
ls "infra/asset_images/$ASSET_ID/" 2>/dev/null | wc -l | tr -d ' '

cyan "[5/6] DB 里 caption 统计"
docker exec -i pg_db psql -U knowledge -d knowledge -tAc \
  "SELECT COUNT(*) FILTER (WHERE caption IS NOT NULL) AS with_cap,
          COUNT(*) AS total
   FROM metadata_asset_image WHERE asset_id = $ASSET_ID;"

cyan "[6/6] 发问 → 看 citations 是否命中 image_caption chunk"
echo "问题：$QUESTION"
curl --noproxy "*" -s -N -X POST http://127.0.0.1:3001/api/qa/ask \
  -H 'Content-Type: application/json' \
  -d "{\"question\":\"$QUESTION\"}" \
  | grep -a '"trace"' | head -1 \
  | sed 's/^data: //' \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
trace = data.get('data', {})
print(f\"检索 {trace.get('initial_count')} 篇 → 保留 {trace.get('kept_count')} 篇\")
for c in trace.get('citations', [])[:5]:
    print(f\"  [{c['index']}] {c['asset_name']} score={c['score']:.3f}\")
    print(f\"      {c['chunk_content'][:120]}\")
"
green "done"
