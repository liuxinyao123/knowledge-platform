#!/usr/bin/env bash
# dev-status.sh — 查看开发栈各服务状态

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PID_DIR=".dev-logs/pids"

green() { printf "\033[32m%s\033[0m" "$*"; }
red()   { printf "\033[31m%s\033[0m" "$*"; }
cyan()  { printf "\033[36m%s\033[0m" "$*"; }

print_row() {
  local name="$1" port="$2" pid_file="$3"
  local status
  local pid=""
  if [ -f "$pid_file" ] && ps -p "$(cat "$pid_file")" >/dev/null 2>&1; then
    pid="$(cat "$pid_file")"
    status="$(green "RUNNING pid=$pid")"
  elif lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    status="$(cyan "listening :$port (no pid file — 非 dev-up 启动)")"
  else
    status="$(red "DOWN")"
  fi
  printf "  %-14s :%-5s  %b\n" "$name" "$port" "$status"
}

echo "=== Dev stack status ==="
print_row qa-service 3001 "$PID_DIR/qa-service.pid"
print_row web        5173 "$PID_DIR/web.pid"

echo
echo "=== Docker 基础设施 ==="
docker compose -f infra/docker-compose.yml ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null \
  || echo "  Docker daemon 未启动"

echo
echo "=== 快速 curl 探活（绕过代理）==="
curl --noproxy "*" -s -o /dev/null -w "  qa-service /api/bookstack/users → HTTP %{http_code}\n" \
     http://127.0.0.1:3001/api/bookstack/users || true
curl --noproxy "*" -s -o /dev/null -w "  bookstack  /                     → HTTP %{http_code}\n" \
     http://127.0.0.1:6875/ || true
curl --noproxy "*" -s -o /dev/null -w "  web        /                     → HTTP %{http_code}\n" \
     http://127.0.0.1:5173/ || true
