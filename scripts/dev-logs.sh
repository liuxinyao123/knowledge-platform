#!/usr/bin/env bash
# dev-logs.sh — 查看后台 dev 服务日志
# 用法：
#   dev-logs.sh                 两个一起 tail（默认）
#   dev-logs.sh qa-service      只看 qa-service
#   dev-logs.sh web             只看 web
#   dev-logs.sh qa-service ingest_done   在 qa-service.log 中 grep 关键字

set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR=".dev-logs"
NAME="${1:-}"
KEY="${2:-}"

if [ -n "$KEY" ]; then
  # grep 关键字；-a 强制文本（防 ANSI/色码被判为二进制）；--color 高亮
  if [ -z "$NAME" ]; then
    grep -a --color=auto -E "$KEY" "$LOG_DIR"/*.log
  else
    grep -a --color=auto -E "$KEY" "$LOG_DIR/$NAME.log"
  fi
  exit 0
fi

if [ -z "$NAME" ]; then
  tail -f "$LOG_DIR/qa-service.log" "$LOG_DIR/web.log" 2>/dev/null
else
  tail -f "$LOG_DIR/$NAME.log"
fi
