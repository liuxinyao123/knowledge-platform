#!/usr/bin/env bash
# dev-up.sh — 一键拉起开发栈：Docker 基础设施 + qa-service + web（全部后台）
# 日志落盘到 .dev-logs/*.log，PID 到 .dev-logs/pids/

set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR=".dev-logs"
PID_DIR="${LOG_DIR}/pids"
mkdir -p "${PID_DIR}"

export NO_PROXY="localhost,127.0.0.1,::1,${NO_PROXY:-}"
export no_proxy="${NO_PROXY}"

cyan()   { printf "\033[36m%s\033[0m\n" "${1:-}"; }
green()  { printf "\033[32m%s\033[0m\n" "${1:-}"; }
red()    { printf "\033[31m%s\033[0m\n" "${1:-}"; }
yellow() { printf "\033[33m%s\033[0m\n" "${1:-}"; }

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
}

start_service() {
  local name="$1"       # qa-service | web
  local filter="$2"     # pnpm --filter target
  local port="$3"       # 端口
  local pid_file="${PID_DIR}/${name}.pid"
  local log_file="${LOG_DIR}/${name}.log"

  if [ -f "${pid_file}" ] && ps -p "$(cat "${pid_file}")" >/dev/null 2>&1; then
    yellow "[skip] ${name} 已在运行 pid=$(cat "${pid_file}")"
    return 0
  fi
  if is_port_listening "${port}"; then
    yellow "[skip] port ${port} 被占用, 跳过 ${name} -- 先 pnpm dev:down 或手动 kill"
    return 0
  fi

  cyan "[start] ${name}  log=${log_file}"
  nohup pnpm --filter "${filter}" dev > "${log_file}" 2>&1 &
  echo $! > "${pid_file}"
  sleep 1
  if ps -p "$(cat "${pid_file}")" >/dev/null 2>&1; then
    green "        ok pid=$(cat "${pid_file}")"
  else
    red "        FAIL -- tail ${log_file}:"
    tail -n 20 "${log_file}" || true
    return 1
  fi
}

# ── 1) Docker 基础设施 ─────────────────────────────────────────────
cyan "[1/3] 启动 Docker 基础设施 (bookstack_db / pg_db / bookstack)"
if ! docker info >/dev/null 2>&1; then
  red "Docker daemon 未启动, 先 open -a Docker 再重试"
  exit 1
fi
docker compose -f infra/docker-compose.yml up -d bookstack_db pg_db bookstack >/dev/null
docker compose -f infra/docker-compose.yml ps --format 'table {{.Name}}\t{{.Status}}' | head -n 5

# ── 2) 等数据库 healthy ─────────────────────────────────────────────
cyan "[2/3] 等待 MySQL:3307 / Postgres:5432 就绪"
for i in $(seq 1 30); do
  if nc -z 127.0.0.1 3307 && nc -z 127.0.0.1 5432; then
    green "        ok"
    break
  fi
  sleep 1
  if [ "${i}" -eq 30 ]; then
    red "超时 30s 未就绪"
    exit 1
  fi
done

# ── 3) qa-service + web ────────────────────────────────────────────
cyan "[3/3] 启动 qa-service 与 web"
start_service qa-service qa-service 3001
start_service web        web        5173

# ── 汇总 ──────────────────────────────────────────────────────────
echo
green "=========================================="
green " Dev stack ready"
green "=========================================="
printf "  BookStack  -> http://localhost:6875\n"
printf "  qa-service -> http://localhost:3001\n"
printf "  web        -> http://localhost:5173\n"
printf "  logs       -> %s/\n" "${LOG_DIR}"
printf "  stop all   -> pnpm dev:down\n"
printf "  tail logs  -> pnpm dev:logs\n"
