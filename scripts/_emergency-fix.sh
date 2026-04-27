#!/usr/bin/env bash
#
# scripts/_emergency-fix.sh
#
# 一次性闭环 fix：解决今天累积的所有问题
#   1. .env 里 API key / AUTH_HS256_SECRET 没值 → 检测 + 提示填
#   2. infra/.env 不存在或缺字段 → 从 apps/qa-service/.env 同步全套
#   3. 端口冲突 → docker-compose.yml 已在 repo 里更新到避让端口
#   4. 镜像里烤死的 .env 覆盖 → volume mount 已在 yaml 里加好
#   5. embeddings: off / auth=none → 透传 + 真值传到位
#
# 用法：
#   bash scripts/_emergency-fix.sh
#
# 一次性工具，跑通后可删。

set -euo pipefail

# ── 颜色 ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[fix]${NC} $*"; }
ok()   { echo -e "${GREEN}[fix]${NC} ✓ $*"; }
warn() { echo -e "${YELLOW}[fix]${NC} ⚠ $*"; }
err()  { echo -e "${RED}[fix]${NC} ✗ $*" >&2; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
QA_ENV="$REPO/apps/qa-service/.env"
INFRA_ENV="$REPO/infra/.env"
COMPOSE="$REPO/infra/docker-compose.yml"

[ -f "$COMPOSE" ] || { err "$COMPOSE 不存在"; exit 1; }
[ -f "$QA_ENV" ] || { err "$QA_ENV 不存在；先跑 install-ubuntu.sh 生成"; exit 1; }

log "Step 1 · 校验 / 补全 API key 与 secret"

# 提取现有值
get_env() { grep -E "^${1}=" "$QA_ENV" 2>/dev/null | cut -d= -f2- | head -1 || true; }
set_env() {
  local k="$1" v="$2"
  if grep -qE "^${k}=" "$QA_ENV"; then
    sed -i.bak "s|^${k}=.*|${k}=${v}|" "$QA_ENV" && rm -f "$QA_ENV.bak"
  else
    echo "${k}=${v}" >> "$QA_ENV"
  fi
}

EMB_KEY=$(get_env EMBEDDING_API_KEY)
LLM_KEY=$(get_env ANTHROPIC_API_KEY)
[ -z "$LLM_KEY" ] && LLM_KEY=$(get_env OPENAI_API_KEY)
AUTH_SEC=$(get_env AUTH_HS256_SECRET)

if [ -z "$EMB_KEY" ]; then
  read -rp "  Embedding API Key（硅基流动 sk-...）: " EMB_KEY
  set_env EMBEDDING_API_KEY "$EMB_KEY"
fi
if [ -z "$LLM_KEY" ]; then
  read -rp "  LLM API Key（Anthropic / OpenAI / 硅基流动；留空 = 复用 EMBEDDING key）: " LLM_KEY
  [ -z "$LLM_KEY" ] && LLM_KEY="$EMB_KEY"
  set_env ANTHROPIC_API_KEY "$LLM_KEY"
fi
if [ -z "$AUTH_SEC" ] || [ ${#AUTH_SEC} -lt 32 ]; then
  AUTH_SEC=$(openssl rand -hex 32)
  set_env AUTH_HS256_SECRET "$AUTH_SEC"
  ok "AUTH_HS256_SECRET 自动生成（32 字节随机）"
fi

# 强制 EMBEDDING_BASE_URL = 硅基流动（如果还是默认 openai 那种）
EMB_URL=$(get_env EMBEDDING_BASE_URL)
if [ -z "$EMB_URL" ] || echo "$EMB_URL" | grep -q openai.com; then
  set_env EMBEDDING_BASE_URL "https://api.siliconflow.cn/v1"
fi

# DB / PG / KG host 强制设成 docker service name（容器内连）
set_env DB_HOST     "bookstack_db"
set_env DB_PORT     "3306"
set_env PG_HOST     "pg_db"
set_env PG_PORT     "5432"
set_env KG_HOST     "kg_db"
set_env KG_PORT     "5432"

ok "apps/qa-service/.env 已校验 + 补全"

log "Step 2 · 重建 infra/.env（compose 替换 \${VAR:-} 走这个文件）"

# 抽出所有 compose 关心的字段写进 infra/.env
# 只挑跟 docker-compose.yml 里 ${VAR:-} 引用对应的字段
{
  echo "# Auto-managed by _emergency-fix.sh · 与 apps/qa-service/.env 同步"
  echo "# compose 替换 \${VAR:-} 用这个文件；qa-service 进程内 dotenvx 用 apps/qa-service/.env"
  for KEY in \
    EMBEDDING_API_KEY EMBEDDING_BASE_URL \
    ANTHROPIC_API_KEY OPENAI_API_KEY OPENAI_BASE_URL OPENAI_EMBEDDING_MODEL \
    AUTH_HS256_SECRET \
    BOOKSTACK_TOKEN_ID BOOKSTACK_TOKEN_SECRET \
    INGEST_VLM_ENABLED INGEST_VLM_MODEL INGEST_OCR INGEST_EXTRACT_HOOK INGEST_MAX_FILE_MB \
    HYBRID_SEARCH_ENABLED L0_GENERATE_ENABLED L0_FILTER_ENABLED L0_GENERATE_CONCURRENCY \
    L0_GENERATE_MIN_CHARS L0_FILTER_TOP_ASSETS L0_LAZY_BACKFILL_ENABLED \
    KG_ENABLED KG_GRAPH \
    INGEST_ASYNC_ENABLED INGEST_ASYNC_THRESHOLD_BYTES INGEST_WORKER_CONCURRENCY \
    INGEST_WORKER_INTERVAL_MS INGEST_WORKER_SHUTDOWN_GRACE_MS \
    VIKING_ENABLED VIKING_BASE_URL VIKING_ROOT_KEY VIKING_RECALL_TIMEOUT_MS VIKING_SAVE_TIMEOUT_MS \
    VIKING_LLM_MODEL VIKING_EMBEDDING_MODEL \
    WEB_SEARCH_PROVIDER TAVILY_API_KEY BING_API_KEY BING_MARKET WEB_SEARCH_TIMEOUT_MS WEB_SEARCH_DEFAULT_TOP_K \
    PGVECTOR_HALF_PRECISION CITATION_IMAGE_URL_ENABLED INLINE_IMAGE_IN_ANSWER_ENABLED
  do
    V=$(get_env "$KEY")
    echo "${KEY}=${V}"
  done
} > "$INFRA_ENV"
chmod 600 "$INFRA_ENV"
ok "infra/.env 重建完成（$(wc -l < "$INFRA_ENV") 行）"

log "Step 3 · 验证 compose 解析后的 effective env（关键字段必须有值）"

# compose config 输出 effective yaml；grep 看关键字段
EFFECTIVE=$(docker compose -f "$COMPOSE" config 2>/dev/null || true)
for K in EMBEDDING_API_KEY AUTH_HS256_SECRET DB_HOST PG_HOST KG_HOST; do
  if echo "$EFFECTIVE" | grep -qE "${K}: [^\"]*\"\"" || \
     echo "$EFFECTIVE" | grep -qE "${K}: $"; then
    warn "$K 在 compose effective 是空值（不致命，但运行时可能影响）"
  fi
done

log "Step 4 · 全栈 down + up（应用新端口 + volume mount + env 透传）"

cd "$REPO/infra"
sudo docker compose down

# 留 build 产物缓存，但确保新 yaml 生效
sudo docker compose up -d

log "Step 5 · 等 60s 让 PG / MySQL 起来 + qa-service migration 跑完"
for i in $(seq 1 12); do
  sleep 5
  printf "."
done
echo ""

log "Step 6 · 状态总览"
sudo docker compose ps
echo ""

log "Step 7 · qa_service 最近 30 行日志"
sudo docker compose logs qa_service --tail 30 || true
echo ""

# 健康检查（新端口 13001）
log "Step 8 · 健康自检"
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo 127.0.0.1)
if curl -sf "http://127.0.0.1:13001/api/health" > /tmp/_health.json 2>&1; then
  ok "qa-service 健康检查通过"
  cat /tmp/_health.json
  rm -f /tmp/_health.json
else
  warn "qa-service /api/health 还没通；如果 logs 里看到 'listening on :3001' 那说明在起，再等 30s"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  访问地址（新端口）："
echo "    Web 控制台:    http://${SERVER_IP}:16875  (BookStack Wiki UI)"
echo "    qa-service:    http://${SERVER_IP}:13001/api/health"
echo "    BookStack:     http://${SERVER_IP}:16875  (同上)"
echo ""
echo "  仅本机调试可连："
echo "    psql pgvector: psql -h 127.0.0.1 -p 15432 -U knowledge -d knowledge"
echo "    psql AGE:      psql -h 127.0.0.1 -p 15433 -U kg -d kg"
echo "    MySQL:         mysql -h 127.0.0.1 -P 13307 -u bookstack -p bookstack"
echo ""
echo "  期望 qa_service 日志关键三行："
echo "    ◇ injected env (N) from .env       ← N > 0 才对"
echo "    ✓ QA service → ... | embeddings: on (https://api.siliconflow.cn/v1) ..."
echo "    ✓ ingest worker started"
echo ""
echo "  如果 embeddings 还是 off，说明 EMBEDDING_API_KEY 还是没正确进容器；"
echo "  跑 sudo docker exec qa_service env | grep EMBEDDING_API_KEY 看实际值。"
echo ""
echo "═══════════════════════════════════════════════════════"
