#!/usr/bin/env bash
# scripts/permissions-v2-seed.sh
#
# Permissions V2 冒烟 seed（对应 docs/verification/permissions-v2-verify.md §5.4 的 6 步手验）
#
# 产出：
#   3 user       alice@corp.com / bob@corp.com / carol@corp.com (默认密码 seed1234)
#   2 team       "市场组" / "销售组"
#   成员绑定     市场组 ← alice, bob；销售组 ← carol
#   1 notebook   "[seed] permissions-v2 冒烟"（owner = admin）
#   notebook 成员  市场组（reader） + alice@corp.com（editor）
#   2 ACL 规则   rule A: team=市场组 allow READ source#<N> TTL=7d
#                rule B: user=bob@corp.com deny READ source#<N>  ← 演示 deny 最高优
#
# 幂等：每一步都先查/try，已存在就跳过；跑多次无副作用。
#
# 用法：
#   bash scripts/permissions-v2-seed.sh                    # 用默认环境
#   bash scripts/permissions-v2-seed.sh --dry-run          # 只打印计划，不发请求
#   QA_BASE=http://... ADMIN_EMAIL=... bash scripts/permissions-v2-seed.sh
#
# 环境变量（全部可 override）：
#   QA_BASE          默认 http://localhost:3001
#   ADMIN_EMAIL      默认 admin@dsclaw.local
#   ADMIN_PASSWORD   默认 admin123
#   PG_CONTAINER     默认 pg_db
#   PG_USER          默认 knowledge
#   PG_DB            默认 knowledge
#   SEED_USER_PW     默认 seed1234（3 个 seed 用户的密码）
#   SOURCE_ID        默认自动取 metadata_source 第一行；可强制
#
# 退出码：0 = 全 OK（含 "已存在即跳过"）；非 0 = 某步骤失败
#
# 依赖：curl + jq（macOS: brew install jq）；如需走 DB 取 source id 还要 docker
set -euo pipefail

# ── 避免 macOS/企业代理劫持 localhost 请求 ────────────────────────────────────
# curl 会尊重 http_proxy / HTTP_PROXY；若代理无法连 localhost，会返 502/503。
# 把 no_proxy 注入为 localhost/127.0.0.1/::1，让 QA_BASE 走直连。
# 用户若显式设过 NO_PROXY，会合并而非覆盖。
_existing_no_proxy="${NO_PROXY:-${no_proxy:-}}"
_base_noproxy="localhost,127.0.0.1,::1"
if [[ -n "$_existing_no_proxy" ]]; then
  export NO_PROXY="${_base_noproxy},${_existing_no_proxy}"
else
  export NO_PROXY="$_base_noproxy"
fi
export no_proxy="$NO_PROXY"

# ── 配置 ──────────────────────────────────────────────────────────────────────

QA_BASE="${QA_BASE:-http://localhost:3001}"
QA_BASE="${QA_BASE%/}"           # 去掉末尾 /
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@dsclaw.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
PG_CONTAINER="${PG_CONTAINER:-pg_db}"
PG_USER="${PG_USER:-knowledge}"
PG_DB="${PG_DB:-knowledge}"
SEED_USER_PW="${SEED_USER_PW:-seed1234}"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

c() { printf "\033[36m%s\033[0m\n" "$*"; }   # cyan  - section
g() { printf "\033[32m%s\033[0m\n" "$*"; }   # green - ok
y() { printf "\033[33m%s\033[0m\n" "$*"; }   # yellow - skip/warn
r() { printf "\033[31m%s\033[0m\n" "$*" >&2; } # red - error
m() { printf "\033[90m  · %s\033[0m\n" "$*"; } # muted detail

die() { r "❌ $*"; exit 1; }

# 全局 token；DEV BYPASS 模式下留空
TOKEN=""

# 记录每步成败（幂等："已存在即跳过"计入 ok）
OK_COUNT=0
SKIP_COUNT=0
FAIL_COUNT=0
FAIL_DETAILS=()

ok_step()   { OK_COUNT=$((OK_COUNT + 1));     g "  ✓ $*"; }
skip_step() { SKIP_COUNT=$((SKIP_COUNT + 1)); y "  ↷ $*（已存在，跳过）"; }
fail_step() { FAIL_COUNT=$((FAIL_COUNT + 1)); r "  ✗ $*"; FAIL_DETAILS+=("$*"); }

# ── 依赖检查 ──────────────────────────────────────────────────────────────────

c "=============================================================="
c " Permissions V2 · 冒烟 seed"
c "=============================================================="
c " QA_BASE       = $QA_BASE"
c " ADMIN_EMAIL   = $ADMIN_EMAIL"
c " PG_CONTAINER  = $PG_CONTAINER"
$DRY_RUN && y " [dry-run] 只打印计划，不发真实请求"
echo

command -v curl >/dev/null 2>&1 || die "curl not found"
command -v jq   >/dev/null 2>&1 || die "jq not found（macOS: brew install jq）"

# ── helper: curl（带 token / 不带 token）──────────────────────────────────────

# 调用：qa_req METHOD PATH [json-body]
# 输出：HTTP status code 写 stderr（形如 "[HTTP 201]"）；response body 写 stdout
# run_qa METHOD PATH [body] → 设置全局 _last_status + _last_body
#   stdout 走 tmp_body；进度/status 走 tmp_status（不混在一起）
run_qa() {
  local method="$1" path="$2" body="${3:-}"

  if $DRY_RUN; then
    printf '\033[90m  [dry-run] %s %s%s\033[0m\n' \
      "$method" "$path" "${body:+ body=$body}"
    # 返回一个能骗过后续 jq 的假响应：含 token / id / 空 items
    _last_body='{"token":"dry-run-fake","id":0,"items":[]}'
    _last_status="200"
    return 0
  fi

  local url="$QA_BASE$path"
  # --noproxy '*' 强制 curl 忽略所有代理（比 NO_PROXY 环境变量更彻底，对付 Clash 系统模式 / 企业透明代理）
  local -a curl_args=(
    -sS -X "$method" -w '\n[HTTP %{http_code}]' -o - "$url"
    --noproxy '*'
    -H 'Content-Type: application/json'
  )
  [[ -n "$TOKEN" ]] && curl_args+=(-H "Authorization: Bearer $TOKEN")
  [[ -n "$body"  ]] && curl_args+=(-d "$body")

  local resp
  if ! resp="$(curl "${curl_args[@]}")"; then
    _last_body='{"_curl_error":"request failed"}'
    _last_status="0"
    return 1
  fi
  # resp 形如 "<body>\n[HTTP 200]"
  _last_status="$(printf '%s' "$resp" | sed -nE 's/.*\[HTTP ([0-9]+)\].*/\1/p' | tail -1)"
  _last_body="$(printf '%s' "$resp" | sed '$d')"   # 去掉最后一行（status）
}

# ── 1. 健康检查 ───────────────────────────────────────────────────────────────

c "▸ 1. 健康检查"
run_qa GET /health
if [[ "$_last_status" != "200" ]]; then
  die "qa-service 未响应 (HTTP=$_last_status)，请先 pnpm dev:up"
fi
ok_step "qa-service /health 通"

# ── 2. 登录 admin → token ─────────────────────────────────────────────────────

c "▸ 2. 登录 admin"
run_qa POST /api/auth/login "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e, password:$p}')"

if [[ "$_last_status" == "200" ]]; then
  TOKEN="$(echo "$_last_body" | jq -r '.token // empty')"
  if [[ -n "$TOKEN" && "$TOKEN" != "null" ]]; then
    ok_step "login 成功，已获取 JWT"
  else
    fail_step "login 200 但未返回 token"
    die "login 响应异常：$_last_body"
  fi
elif [[ "$_last_status" == "500" ]]; then
  y "  ⚠ /api/auth/login 返 500 —— 可能是 AUTH_HS256_SECRET 未配置 → 降级为 DEV BYPASS 模式"
  TOKEN=""
  ok_step "DEV BYPASS（qa-service 未配登录，按 admin 全集放行）"
else
  die "login 失败 (HTTP=$_last_status)：$_last_body"
fi

# ── 3. 创建 3 个 seed 用户 ────────────────────────────────────────────────────

c "▸ 3. 创建 seed 用户"

SEED_USERS=("alice@corp.com" "bob@corp.com" "carol@corp.com")

for u in "${SEED_USERS[@]}"; do
  payload="$(jq -nc --arg e "$u" --arg p "$SEED_USER_PW" '{email:$e, password:$p, roles:["viewer"]}')"
  run_qa POST /api/auth/register "$payload"
  case "$_last_status" in
    200|201) ok_step "user $u 创建" ;;
    409)     skip_step "user $u" ;;
    *)       fail_step "user $u (HTTP=$_last_status): $_last_body" ;;
  esac
done

# ── 4. 创建 2 个 team ─────────────────────────────────────────────────────────

c "▸ 4. 创建 team"

# macOS 默认 bash 3.2 不支持关联数组，用两个并行变量（MARKET_ID / SALES_ID）
MARKET_ID=""
SALES_ID=""

for t in "市场组:市场相关权限分发（seed）" "销售组:销售相关权限分发（seed）"; do
  name="${t%%:*}"
  desc="${t#*:}"
  payload="$(jq -nc --arg n "$name" --arg d "$desc" '{name:$n, description:$d}')"
  run_qa POST /api/iam/teams "$payload"
  case "$_last_status" in
    200|201)
      id="$(echo "$_last_body" | jq -r '.id')"
      case "$name" in
        "市场组") MARKET_ID="$id" ;;
        "销售组") SALES_ID="$id" ;;
      esac
      ok_step "team \"$name\" 创建 (id=$id)"
      ;;
    409)
      skip_step "team \"$name\""
      ;;
    *)
      fail_step "team \"$name\" (HTTP=$_last_status): $_last_body"
      ;;
  esac
done

# 补齐已存在 team 的 id（第一次跑就是 create 返的 id；后续幂等跑靠这里补）
c "▸ 4b. 查询所有 team id"
run_qa GET /api/iam/teams
if [[ "$_last_status" == "200" ]]; then
  [[ -z "$MARKET_ID" ]] && MARKET_ID="$(echo "$_last_body" | jq -r '.items[]? | select(.name == "市场组") | .id' | head -1)"
  [[ -z "$SALES_ID"  ]] && SALES_ID="$(echo  "$_last_body" | jq -r '.items[]? | select(.name == "销售组") | .id' | head -1)"
  m "市场组 -> id=${MARKET_ID:-<missing>}"
  m "销售组 -> id=${SALES_ID:-<missing>}"
else
  fail_step "GET /api/iam/teams (HTTP=$_last_status)"
fi

if [[ -z "$MARKET_ID" || -z "$SALES_ID" ]]; then
  r "  ⚠ 未能解出 team id，后续依赖 team 的步骤会跳过"
fi

# ── 5. 给 team 加成员（upsert，天然幂等）──────────────────────────────────────

c "▸ 5. 给 team 加成员"

add_team_member() {
  local team_id="$1" email="$2" role="${3:-member}"
  [[ -z "$team_id" ]] && { skip_step "team_id 缺失，$email"; return; }
  local payload; payload="$(jq -nc --arg e "$email" --arg r "$role" '{user_email:$e, role:$r}')"
  run_qa POST "/api/iam/teams/$team_id/members" "$payload"
  case "$_last_status" in
    200|201) ok_step "$email → team#$team_id ($role)" ;;
    *)       fail_step "$email → team#$team_id (HTTP=$_last_status): $_last_body" ;;
  esac
}

add_team_member "$MARKET_ID" "alice@corp.com" "member"
add_team_member "$MARKET_ID" "bob@corp.com"   "member"
add_team_member "$SALES_ID"  "carol@corp.com" "member"

# ── 6. 创建 / 复用 notebook ───────────────────────────────────────────────────

c "▸ 6. 创建 notebook"

NB_NAME="[seed] permissions-v2 冒烟"
NB_ID=""

run_qa GET /api/notebooks
if [[ "$_last_status" == "200" ]]; then
  # 在 items（owner = 当前 admin）里找同名
  NB_ID="$(echo "$_last_body" | jq -r --arg n "$NB_NAME" '.items[]? | select(.name == $n) | .id' | head -1)"
fi

if [[ -n "$NB_ID" ]]; then
  skip_step "notebook \"$NB_NAME\" 已存在 (id=$NB_ID)"
else
  payload="$(jq -nc --arg n "$NB_NAME" --arg d "用于 permissions-v2 的 6 步冒烟验证（可随时删）" '{name:$n, description:$d}')"
  run_qa POST /api/notebooks "$payload"
  case "$_last_status" in
    200|201)
      NB_ID="$(echo "$_last_body" | jq -r '.id')"
      ok_step "notebook 创建 (id=$NB_ID)"
      ;;
    *)
      fail_step "notebook 创建 (HTTP=$_last_status): $_last_body"
      ;;
  esac
fi

# ── 7. notebook 成员（upsert）────────────────────────────────────────────────

c "▸ 7. notebook 共享"

add_nb_member() {
  local stype="$1" sid="$2" role="$3"
  [[ -z "$NB_ID" ]] && { skip_step "notebook id 缺失，$stype:$sid"; return; }
  local payload; payload="$(jq -nc --arg st "$stype" --arg si "$sid" --arg r "$role" \
    '{subject_type:$st, subject_id:$si, role:$r}')"
  run_qa POST "/api/notebooks/$NB_ID/members" "$payload"
  case "$_last_status" in
    200|201) ok_step "notebook#$NB_ID ← $stype:$sid ($role)" ;;
    *)       fail_step "notebook#$NB_ID ← $stype:$sid (HTTP=$_last_status): $_last_body" ;;
  esac
}

[[ -n "$MARKET_ID" ]] && add_nb_member "team" "$MARKET_ID" "reader"
add_nb_member "user" "alice@corp.com" "editor"

# ── 8. source id（默认取第一条）──────────────────────────────────────────────

c "▸ 8. 解出 source_id"

SRC_ID="${SOURCE_ID:-}"
if [[ -z "$SRC_ID" ]]; then
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${PG_CONTAINER}$"; then
    SRC_ID="$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At \
      -c "SELECT id FROM metadata_source ORDER BY id LIMIT 1;" 2>/dev/null || true)"
    [[ -n "$SRC_ID" ]] && m "从 DB 取到 source_id=$SRC_ID"
  fi
fi
if [[ -z "$SRC_ID" ]]; then
  # 回退：约定 BookStack seed 总在 id=1
  SRC_ID=1
  y "  ⚠ 无法从 DB 取 source_id，回退到 SRC_ID=1（可设 SOURCE_ID 环境变量强制）"
fi

# ── 9. 2 条样板 ACL 规则（幂等：按 subject+permission+source 去重）────────────

c "▸ 9. 创建样板 ACL 规则"

# 查 source_id 下现有规则
run_qa GET "/api/acl/rules?source_id=$SRC_ID"
existing_rules="{}"
if [[ "$_last_status" == "200" ]]; then
  existing_rules="$_last_body"
fi

has_rule() {
  # has_rule subject_type subject_id permission effect → echo 'yes' if exists
  local st="$1" si="$2" p="$3" e="$4"
  echo "$existing_rules" | jq -e --arg st "$st" --arg si "$si" --arg p "$p" --arg e "$e" \
    '.items[]? | select(.subject_type == $st and (.subject_id|tostring) == $si and .permission == $p and (.effect // "allow") == $e)' \
    >/dev/null 2>&1 && echo yes
}

create_rule() {
  local st="$1" si="$2" p="$3" e="$4" exp="${5:-}"
  local desc="$st:$si $p $e"
  [[ -n "$(has_rule "$st" "$si" "$p" "$e")" ]] && { skip_step "rule $desc on source#$SRC_ID"; return; }
  local payload
  if [[ -n "$exp" ]]; then
    payload="$(jq -nc --argjson src "$SRC_ID" --arg st "$st" --arg si "$si" --arg p "$p" --arg e "$e" --arg x "$exp" \
      '{source_id:$src, subject_type:$st, subject_id:$si, permission:$p, effect:$e, expires_at:$x}')"
  else
    payload="$(jq -nc --argjson src "$SRC_ID" --arg st "$st" --arg si "$si" --arg p "$p" --arg e "$e" \
      '{source_id:$src, subject_type:$st, subject_id:$si, permission:$p, effect:$e}')"
  fi
  run_qa POST /api/acl/rules "$payload"
  case "$_last_status" in
    200|201)
      local id; id="$(echo "$_last_body" | jq -r '.id')"
      ok_step "rule $desc on source#$SRC_ID (id=$id)${exp:+, expires=$exp}"
      ;;
    *)
      fail_step "rule $desc on source#$SRC_ID (HTTP=$_last_status): $_last_body"
      ;;
  esac
}

# TTL = 现在 + 7 天（ISO）
EXPIRES_7D="$(date -u -v +7d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
  || date -u -d '+7 days' +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
  || echo '')"

# 样板 A：市场组 READ 允许（带 TTL）
if [[ -n "$MARKET_ID" ]]; then
  create_rule team "$MARKET_ID" READ allow "$EXPIRES_7D"
else
  skip_step "样板 A（市场组 team_id 缺失）"
fi

# 样板 B：bob DENY READ（演示 deny 最高优：bob 虽在市场组里有 allow，但 deny 会压过）
create_rule user "bob@corp.com" READ deny

# ── 总结 ──────────────────────────────────────────────────────────────────────

echo
c "=============================================================="
c " 总结"
c "=============================================================="
g "  ✓ 成功: $OK_COUNT 步"
y "  ↷ 跳过: $SKIP_COUNT 步（幂等）"
if [[ $FAIL_COUNT -gt 0 ]]; then
  r "  ✗ 失败: $FAIL_COUNT 步"
  for d in "${FAIL_DETAILS[@]}"; do
    r "      - $d"
  done
  echo
  r "有步骤失败，请根据日志排查（大多是 qa-service 未重启 / migration 未跑）"
  exit 1
fi
echo
g "全部步骤 OK。下一步按 docs/verification/permissions-v2-verify.md §5.4 的 6 步做浏览器手验："
echo "  1. /iam?tab=teams  → 确认 2 个 team 在列"
echo "  2. /iam?tab=rules  → 确认 source#$SRC_ID 下有 2 条 seed 规则"
echo "  3. /iam?tab=audit  → 应看到上面 CREATE 流水"
echo "  4. /notebooks      → admin 侧看到 \"$NB_NAME\" 作为 owner"
echo "     切 alice@corp.com / $SEED_USER_PW 登录 → 「共享给我的」区段应看到该 notebook"
echo "  5. /space-tree     → source#$SRC_ID 行右端 🔒 → 应看到刚种的 2 条规则"
echo "  6. /assets/<id>    → 顶栏 🔒 打开抽屉 → 同 5"
echo
echo "要清理 seed 数据：执行反向 DELETE 或手动在 IAM UI 里删（本脚本不提供 cleanup，避免误删）"
