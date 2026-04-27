#!/bin/bash
# dev-stop.sh —— 停掉所有本地 dev 进程（docker 容器保留）
#
# 用法：
#   ./scripts/dev-stop.sh
#
# 如果想连 docker 容器一起停：
#   cd infra && docker compose stop

echo "停掉 qa-service / vite..."
pkill -9 -f 'tsx.*qa-service'  2>/dev/null && echo "  · killed tsx/qa-service"  || true
pkill -9 -f 'node.*qa-service' 2>/dev/null && echo "  · killed node/qa-service" || true
pkill -9 -f 'vite.*web'        2>/dev/null && echo "  · killed vite"            || true
pkill -9 -f 'node.*vite'       2>/dev/null || true

# 确认端口释放
for port in 3001 5173 5174; do
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  ⚠ :$port 仍被占用"
  fi
done

echo "完成。docker 容器（pg_db / kg_db）仍在跑；如要停：cd infra && docker compose stop"
