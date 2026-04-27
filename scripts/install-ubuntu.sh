#!/usr/bin/env bash
#
# scripts/install-ubuntu.sh
#
# 知源 · ZhiYuan · Knowledge Platform —— Ubuntu 一键部署脚本
#
# 适用：Ubuntu 22.04 LTS / 24.04 LTS（其它发行版 yum/apt 包名不同，自行调整）
# 用法：
#   sudo bash scripts/install-ubuntu.sh                    # 交互式（推荐）
#   sudo bash scripts/install-ubuntu.sh --non-interactive  # 用环境变量批量装
#   sudo bash scripts/install-ubuntu.sh --upgrade          # 已部署 → 仅重建镜像 + 重启
#
# 必需环境变量（--non-interactive 模式）：
#   EMBEDDING_API_KEY     硅基流动 / OpenAI 兼容 Embedding key
#   LLM_API_KEY           ANTHROPIC_API_KEY 或 OPENAI_API_KEY 任选
#
# 可选环境变量：
#   INSTALL_DIR           默认 当前工作目录（脚本所在 repo 根）
#   ADMIN_EMAIL           初始管理员邮箱，默认 admin@dsclaw.local
#   ADMIN_PASSWORD        初始管理员密码，默认 admin123（生产请改！）
#   PG_PASS / MYSQL_PASS  DB 密码，未设则自动生成 32 字节随机
#
# 退出码：0 成功 · 1 前置检查失败 · 2 装机失败 · 3 起栈失败

set -euo pipefail

# ── 颜色 ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[ZhiYuan]${NC} $*"; }
ok()   { echo -e "${GREEN}[ZhiYuan]${NC} ✓ $*"; }
warn() { echo -e "${YELLOW}[ZhiYuan]${NC} ⚠ $*"; }
err()  { echo -e "${RED}[ZhiYuan]${NC} ✗ $*" >&2; }

# ── 参数解析 ──────────────────────────────────────────────────────────────
NON_INTERACTIVE=false
UPGRADE_ONLY=false
for a in "$@"; do
  case "$a" in
    --non-interactive) NON_INTERACTIVE=true ;;
    --upgrade)         UPGRADE_ONLY=true ;;
    -h|--help)
      sed -n '4,25p' "$0"; exit 0 ;;
    *) err "未知参数: $a"; exit 1 ;;
  esac
done

# ── 前置检查 ──────────────────────────────────────────────────────────────
log "=== Step 0 · 前置检查 ==="

# root 检查
if [ "$EUID" -ne 0 ]; then
  err "请用 sudo 运行（需要装 Docker、写 systemd 服务等）"
  exit 1
fi

# OS 检查
if [ ! -f /etc/os-release ]; then
  err "/etc/os-release 不存在，无法识别系统"
  exit 1
fi
. /etc/os-release
case "$ID" in
  ubuntu) ok "系统：Ubuntu $VERSION_ID" ;;
  debian) warn "系统：Debian $VERSION_ID（非官方支持，apt 包名一致应可工作）" ;;
  kylin|uos|openEuler)
    warn "系统：$PRETTY_NAME（国产化系统，本脚本 apt 路径不通；请用 yum/dnf 自行调整）"
    err "本脚本仅自动化 Ubuntu/Debian；其它发行版请手动 docker compose"
    exit 1 ;;
  *) err "不识别的系统 $ID；请手动 docker compose"; exit 1 ;;
esac

# CPU / RAM / 磁盘
CPU_CORES=$(nproc)
RAM_GB=$(awk '/MemTotal/ {printf "%.0f", $2/1024/1024}' /proc/meminfo)
DISK_GB=$(df -BG --output=avail / | tail -1 | tr -d 'G ')

log "硬件：${CPU_CORES} 核 / ${RAM_GB} GB RAM / ${DISK_GB} GB 可用磁盘"
[ "$CPU_CORES" -lt 2 ] && warn "CPU < 2 核，仅够最小化跑（README §服务器配置要求 起步档要求 4 核）"
[ "$RAM_GB" -lt 7 ] && warn "RAM < 8 GB，PDF ingest 峰值可能 OOM（建议 ≥ 8 GB）"
[ "$DISK_GB" -lt 30 ] && { err "磁盘 < 30 GB，无法继续"; exit 1; }

# 决定 INSTALL_DIR
INSTALL_DIR="${INSTALL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
[ -d "$INSTALL_DIR/infra" ] || { err "$INSTALL_DIR 不像 zhiyuan repo 根（缺 infra/）"; exit 1; }
ok "项目根：$INSTALL_DIR"
cd "$INSTALL_DIR"

# 升级模式短路：跳过装 Docker、跳过 .env 生成
if [ "$UPGRADE_ONLY" = true ]; then
  log "=== --upgrade 模式：仅重建镜像 + 重启容器 ==="
  cd infra
  docker compose build
  docker compose up -d
  ok "升级完成"
  exit 0
fi

# ── 装 Docker ────────────────────────────────────────────────────────────
log "=== Step 1 · Docker ==="

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',') + Compose $(docker compose version --short) 已就绪"
else
  log "装 Docker（来自 docker 官方源，国内机器可能很慢）..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg lsb-release
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  ok "Docker 装好"
fi

# 把当前用户加入 docker 组（如果不是 root sudo 调用）
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  if ! groups "$SUDO_USER" | grep -qw docker; then
    usermod -aG docker "$SUDO_USER"
    warn "已把 $SUDO_USER 加入 docker 组；下次登录后免 sudo 跑 docker"
  fi
fi

# ── swap 兜底（RAM < 16GB 时加 8GB swap，防 ingest 峰值 OOM）─────────────
if [ "$RAM_GB" -lt 16 ] && ! swapon --show | grep -q '/swapfile'; then
  log "=== Step 1.5 · 加 8 GB swap（RAM 不足 16 GB 兜底）==="
  fallocate -l 8G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "swap 8 GB 已加并写入 /etc/fstab"
fi

# ── 生成 .env ─────────────────────────────────────────────────────────────
log "=== Step 2 · 生成 apps/qa-service/.env ==="

ENV_FILE="$INSTALL_DIR/apps/qa-service/.env"
ENV_EXAMPLE="$INSTALL_DIR/apps/qa-service/.env.example"

if [ -f "$ENV_FILE" ]; then
  warn "$ENV_FILE 已存在；不覆盖。如需重置：rm 它再跑本脚本"
else
  [ -f "$ENV_EXAMPLE" ] || { err "$ENV_EXAMPLE 不存在，repo 不完整？"; exit 2; }

  # 交互式收集敏感参数
  if [ "$NON_INTERACTIVE" = false ]; then
    [ -z "${EMBEDDING_API_KEY:-}" ] && { read -rp "硅基流动 / OpenAI Embedding API Key: " EMBEDDING_API_KEY; }
    [ -z "${LLM_API_KEY:-}" ] && { read -rp "LLM API Key（Anthropic / OpenAI / SiliconFlow 任选）: " LLM_API_KEY; }
  fi
  [ -z "${EMBEDDING_API_KEY:-}" ] && { err "EMBEDDING_API_KEY 必填"; exit 1; }
  [ -z "${LLM_API_KEY:-}" ] && { err "LLM_API_KEY 必填"; exit 1; }

  # 自动生成的密码 / 密钥
  AUTH_HS256_SECRET="$(openssl rand -hex 32)"
  PG_PASS="${PG_PASS:-$(openssl rand -hex 16)}"
  MYSQL_PASS="${MYSQL_PASS:-$(openssl rand -hex 16)}"
  ADMIN_EMAIL="${ADMIN_EMAIL:-admin@dsclaw.local}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

  cp "$ENV_EXAMPLE" "$ENV_FILE"
  # 用 sed 替换关键变量；变量名前后加 = 防误伤
  sed -i \
    -e "s|^EMBEDDING_API_KEY=.*|EMBEDDING_API_KEY=$EMBEDDING_API_KEY|" \
    -e "s|^EMBEDDING_BASE_URL=.*|EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1|" \
    -e "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$LLM_API_KEY|" \
    -e "s|^AUTH_HS256_SECRET=.*|AUTH_HS256_SECRET=$AUTH_HS256_SECRET|" \
    -e "s|^PG_PASS=.*|PG_PASS=$PG_PASS|" \
    -e "s|^DB_PASS=.*|DB_PASS=$MYSQL_PASS|" \
    "$ENV_FILE" || true

  # 把 admin 凭据写到一个 unmanaged 文件（不进 git，方便首次登录后改）
  cat > "$INSTALL_DIR/.first-admin-credentials.txt" <<EOF
首次启动后用以下凭据登录 http://YOUR_SERVER:5173 ：
  Email:    $ADMIN_EMAIL
  Password: $ADMIN_PASSWORD

⚠️ 生产环境请立即改密码并删除本文件。
EOF
  chmod 600 "$INSTALL_DIR/.first-admin-credentials.txt"

  ok ".env 已生成（敏感字段已注入；其它字段保持 .env.example 默认）"
fi

# ── 镜像 build + 起栈 ────────────────────────────────────────────────────
log "=== Step 3 · Docker 镜像 build（首次约 5–10 分钟）==="
cd "$INSTALL_DIR/infra"
docker compose build 2>&1 | tail -20
ok "镜像 build 完成"

log "=== Step 4 · 起栈 ==="
docker compose up -d
ok "5 容器已启动"

# ── 健康检查 ──────────────────────────────────────────────────────────────
log "=== Step 5 · 健康检查（最多等 90s）==="
ATTEMPTS=18
SLEEP=5
for i in $(seq 1 $ATTEMPTS); do
  HEALTHY=$(docker compose ps --format json 2>/dev/null | grep -c '"Health":"healthy"' || true)
  RUNNING=$(docker compose ps --format json 2>/dev/null | grep -c '"State":"running"' || true)
  if curl -sf http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    ok "qa-service 健康检查通过（$RUNNING 容器在跑）"
    break
  fi
  if [ "$i" -eq "$ATTEMPTS" ]; then
    err "qa-service 90s 内未就绪。诊断："
    err "  docker compose -f infra/docker-compose.yml logs qa-service --tail 50"
    exit 3
  fi
  sleep "$SLEEP"
done

# ── 总结 ──────────────────────────────────────────────────────────────────
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$SERVER_IP" ] && SERVER_IP="<your-ip>"

echo ""
echo "════════════════════════════════════════════════════════════════"
ok "✅ 知源 ZhiYuan 部署完成"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "  访问地址："
echo "    Web 控制台:   http://${SERVER_IP}:5173"
echo "    qa-service:   http://${SERVER_IP}:3001/api/health"
echo "    BookStack:    http://${SERVER_IP}:6875"
echo "    mcp-service:  http://${SERVER_IP}:3002/mcp（如启用）"
echo ""
if [ -f "$INSTALL_DIR/.first-admin-credentials.txt" ]; then
  echo "  首次登录凭据：见 $INSTALL_DIR/.first-admin-credentials.txt"
  echo "  ⚠️  登录后立即改密码并删除该文件"
fi
echo ""
echo "  常用运维命令："
echo "    查看日志:     docker compose -f $INSTALL_DIR/infra/docker-compose.yml logs -f"
echo "    停止:         docker compose -f $INSTALL_DIR/infra/docker-compose.yml down"
echo "    重启:         docker compose -f $INSTALL_DIR/infra/docker-compose.yml restart"
echo "    升级镜像:     sudo bash $0 --upgrade"
echo ""
echo "  下一步："
echo "    1. 浏览器开 http://${SERVER_IP}:5173 登录"
echo "    2. BookStack（http://${SERVER_IP}:6875）创建 API token，写回 .env 的"
echo "       BOOKSTACK_TOKEN_ID / BOOKSTACK_TOKEN_SECRET，然后 docker compose restart qa_service"
echo "    3. 看 README §快速开始 把 ingest / search 跑通"
echo "════════════════════════════════════════════════════════════════"
