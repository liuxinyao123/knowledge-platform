#!/usr/bin/env bash
# dev-down.sh — 停止后台 qa-service / web；Docker 基础设施默认不动
# 加 --all 同时 docker compose stop

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PID_DIR=".dev-logs/pids"

cyan()  { printf "\033[36m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }

stop_service() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file")"
    if ps -p "$pid" >/dev/null 2>&1; then
      # kill 子进程组（pnpm 会 fork vite/node）
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
      sleep 1
      if ps -p "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" 2>/dev/null || true
      fi
      green "• 停掉 $name (pid $pid)"
    else
      cyan "• $name 进程已不在"
    fi
    rm -f "$pid_file"
  else
    cyan "• $name 未在运行"
  fi
}

# 兜底：按端口强杀遗留
kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
    green "• 清理端口 :$port 残留 pid: $pids"
  fi
}

stop_service qa-service
stop_service web
kill_port 3001
kill_port 5173

if [ "${1:-}" = "--all" ]; then
  cyan "→ docker compose stop（保留数据卷）"
  docker compose -f infra/docker-compose.yml stop
  green "• Docker 基础设施已停"
else
  cyan "→ Docker 基础设施保留运行；要一起停：pnpm dev:down --all"
fi
