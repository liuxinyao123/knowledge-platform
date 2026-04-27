#!/bin/bash
# dev-restart.sh —— 一键重启全套本地 dev 环境
#
# 做这些事：
#   1. 杀掉所有旧的 qa-service / vite 进程
#   2. 确保 docker 容器（pg_db / kg_db）在跑
#   3. 等端口 3001 / 5173 / 5174 释放
#   4. 后台起 qa-service + web，日志到 /tmp/kp-logs/
#   5. 打印最近日志；用户可以 Ctrl+C tail，dev 进程继续跑
#
# 用法（从仓库任意位置）：
#   ./scripts/dev-restart.sh
#
# 停服务：
#   ./scripts/dev-stop.sh   （或手动 pkill -9 -f 'tsx\|vite'）

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
LOG_DIR="/tmp/kp-logs"
mkdir -p "$LOG_DIR"

echo "============================================================"
echo " knowledge-platform · dev 全量重启"
echo " repo: $REPO_ROOT"
echo " logs: $LOG_DIR"
echo "============================================================"

# ── [1/5] 杀掉旧进程 ───────────────────────────────────────────
echo ""
echo "[1/5] 杀掉旧 dev 进程..."
pkill -9 -f 'tsx.*qa-service'  2>/dev/null && echo "  · killed tsx/qa-service"  || true
pkill -9 -f 'node.*qa-service' 2>/dev/null && echo "  · killed node/qa-service" || true
pkill -9 -f 'vite.*web'        2>/dev/null && echo "  · killed vite"            || true
pkill -9 -f 'node.*vite'       2>/dev/null || true
sleep 1

# ── [2/5] docker 容器 ──────────────────────────────────────────
echo ""
echo "[2/5] 确保 docker 容器在跑..."
cd "$REPO_ROOT/infra"
docker compose up -d pg_db kg_db
cd "$REPO_ROOT"

# ── [3/5] 等端口释放 ──────────────────────────────────────────
echo ""
echo "[3/5] 等端口释放 (3001 / 5173 / 5174)..."
for port in 3001 5173 5174; do
  for i in {1..10}; do
    if ! lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      break
    fi
    echo "  · :$port 仍被占用，等 1s..."
    sleep 1
  done
done

# ── [4/5] 启动后台 dev ────────────────────────────────────────
echo ""
echo "[4/5] 后台启动 qa-service + web..."
rm -f "$LOG_DIR/qa.log" "$LOG_DIR/web.log"

(cd "$REPO_ROOT/apps/qa-service" && pnpm dev > "$LOG_DIR/qa.log" 2>&1) &
QA_PID=$!
(cd "$REPO_ROOT/apps/web" && pnpm dev > "$LOG_DIR/web.log" 2>&1) &
WEB_PID=$!

echo "  · qa-service pid=$QA_PID  → tail -f $LOG_DIR/qa.log"
echo "  · web        pid=$WEB_PID → tail -f $LOG_DIR/web.log"

# 给进程几秒启动
sleep 4

# ── [5/5] 验证 ────────────────────────────────────────────────
echo ""
echo "[5/5] 健康检查..."
echo ""

HEALTH=$(curl -s --noproxy '*' -m 3 http://localhost:3001/health 2>&1 || echo "FAIL")
if [[ "$HEALTH" == *"ok"* ]]; then
  echo "  ✓ qa-service /health: $HEALTH"
else
  echo "  ✗ qa-service /health 失败：$HEALTH"
  echo "    → 看启动日志: tail -f $LOG_DIR/qa.log"
fi

KG_STATUS=$(curl -s --noproxy '*' -m 3 -o /dev/null -w "%{http_code}" http://localhost:3001/api/kg/status 2>&1 || echo "FAIL")
echo "  · /api/kg/status HTTP $KG_STATUS  (401=要token，200=已通，404=路由没挂)"

# KG bootstrap 日志摘要
echo ""
echo "  · KG bootstrap 日志："
grep -E 'Apache AGE|graphDb' "$LOG_DIR/qa.log" | head -5 | sed 's/^/    /' || true

echo ""
echo "============================================================"
echo " 全部就绪。前端地址："
echo "   http://localhost:5173   (或 5174，看 web.log)"
echo ""
echo " 看日志："
echo "   tail -f $LOG_DIR/qa.log"
echo "   tail -f $LOG_DIR/web.log"
echo ""
echo " 停服务："
echo "   ./scripts/dev-stop.sh"
echo "============================================================"
