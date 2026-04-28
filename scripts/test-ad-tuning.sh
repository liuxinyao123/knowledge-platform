#!/usr/bin/env bash
# A+D 调优实测脚本
#
# 跑前提：
#   1. pnpm dev:up（或 pnpm dev:restart，确保拿到改后的 ragPipeline.ts）
#   2. 知识库里至少有一份《道德经》文档（你之前的截图里已经有）
#
# 跑 4 条 case，对照 condense 开/关 + prompt D 改前后行为：
#   case1a  "那你把原文发我"    + 道德经 history  + condense ON  → 期望：触发 🪄 改写 + 命中
#   case1b  "那你把原文发我"    + 道德经 history  + condense OFF → 期望：走 0.027 short-circuit 兜底（旧行为）
#   case2a  "给他的原文的解释"  + 第一章 history  + D 后 prompt  → 期望：白话释义而非"知识库中没有"
#   case2b  "什么是道？"        + 空 history                     → 期望：condense 不触发（history 空），不影响普通问题
#
# 注意：这 4 条 case 之间互相独立，不需要按顺序。

set -uo pipefail

API="${API:-http://localhost:3001}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@dsclaw.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
TMP="$(mktemp -d)"
# 不删 tmp —— 实测要看完整答案
echo "→ 输出目录: $TMP"

# 全局把 HTTP 代理从本进程剥掉，免得 ClashX/Surge 把 localhost 也代理掉
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy 2>/dev/null || true
NO_PROXY="*"; export NO_PROXY no_proxy="*"

CURL_BASE=(curl -sS --noproxy '*' --max-time 60)

# ── 健康检查（端口探活）────────────────────────────────────────────────────
PORT="${API##*:}"
if ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
  echo "❌ qa-service 没起（$API 端口连不上），先跑 'pnpm dev:up'" >&2
  exit 1
fi

# ── 登录拿 token（auth=hs256 时必需；dev bypass 时 token 取空也能过） ───────
echo "→ 登录 $ADMIN_EMAIL ..."
LOGIN_RESP="$("${CURL_BASE[@]}" -X POST "$API/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>&1 || true)"
TOKEN="$(printf '%s' "$LOGIN_RESP" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
if [ -z "$TOKEN" ]; then
  echo "❌ 登录失败 / 返回里没找到 token；接口原始响应："
  echo "$LOGIN_RESP" | head -c 400; echo
  echo "  · 检查 admin 邮箱密码：默认是 admin@dsclaw.local / admin123"
  echo "  · 或自定义：ADMIN_EMAIL=xx ADMIN_PASSWORD=yy bash $0"
  exit 1
fi
echo "✓ 拿到 token (len=${#TOKEN})"
AUTH_HEADER="Authorization: Bearer $TOKEN"

# ── SSE 解析助手：从 stream 里抽 rag_step / agent_selected / content 头几段 ──
parse_sse() {
  # 入参：SSE 文件路径
  awk '
    /^data: / {
      payload = substr($0, 7)
      if (payload ~ /"rag_step"/) {
        match(payload, /"icon":"[^"]*"/); icon = substr(payload, RSTART+8, RLENGTH-9)
        match(payload, /"label":"[^"]*"/); label = substr(payload, RSTART+9, RLENGTH-10)
        printf("  %s %s\n", icon, label)
      } else if (payload ~ /"agent_selected"/) {
        match(payload, /"intent":"[^"]*"/); intent = substr(payload, RSTART+10, RLENGTH-11)
        printf("  🤖 agent_selected → intent=%s\n", intent)
      } else if (payload ~ /"content"/) {
        n_content++
      } else if (payload ~ /"trace"/) {
        match(payload, /"initial_count":[0-9]+/); ic = substr(payload, RSTART+16, RLENGTH-16)
        match(payload, /"kept_count":[0-9]+/); kc = substr(payload, RSTART+13, RLENGTH-13)
        printf("  📊 trace → initial=%s kept=%s, content_chunks=%d\n", ic, kc, n_content)
      } else if (payload ~ /"error"/) {
        printf("  ❌ error: %s\n", payload)
      }
    }
    END {
      if (n_content > 0) printf("  💬 收到 %d 段 content（已生成回答）\n", n_content)
      else printf("  ⛔ 没有 content（要么 short-circuit 要么 LLM 没吐字）\n")
    }
  ' "$1"
}

# ── 通用 curl 跑 SSE ────────────────────────────────────────────────────────
run_case() {
  local name="$1" body_file="$2"
  local out="$TMP/$name.sse"
  echo
  echo "═══ $name ═══"
  curl -sN --noproxy '*' -X POST "$API/api/agent/dispatch" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    --max-time 60 \
    --data-binary @"$body_file" > "$out" 2>&1 || true
  parse_sse "$out"
}

# ── case1a：condense ON → 期望 🪄 改写 + 命中 ───────────────────────────────
cat > "$TMP/c1a.json" <<'EOF'
{
  "question": "那你把原文发我",
  "session_id": "test-ad-c1a",
  "history": [
    {"role":"user","content":"道德经是谁写的"},
    {"role":"assistant","content":"《道德经》的作者是老子。"},
    {"role":"user","content":"你给我道德经第一章的内容"},
    {"role":"assistant","content":"道可道，非常道；名可名，非常名。无名，天地之始；有名，万物之母。"}
  ]
}
EOF
run_case "case1a · condense ON · 那你把原文发我" "$TMP/c1a.json"

# ── case1b：condense OFF → 期望 short-circuit 兜底 ──────────────────────────
# 临时关 condense 需要重启服务才生效；这条留给手测：
#
#   1. cd apps/qa-service
#   2. echo 'RAG_CONDENSE_QUESTION_ENABLED=false' >> .env
#   3. pnpm dev:restart
#   4. 重跑 case1a 命令，对照 case1a 的输出差异
#   5. 测完把 .env 里那行删掉重启
echo
echo "═══ case1b · condense OFF（手动）═══"
echo "  ⓘ 这条需要临时关 condense：在 apps/qa-service/.env 加一行"
echo "    RAG_CONDENSE_QUESTION_ENABLED=false"
echo "    pnpm dev:restart 后重跑 case1a 的 curl，对照差异。"
echo "    期望：旧行为 → ⛔ short-circuit + 0.027 兜底文案"

# ── case2a：D 验证 → 期望白话释义 ──────────────────────────────────────────
cat > "$TMP/c2a.json" <<'EOF'
{
  "question": "给他的原文的解释",
  "session_id": "test-ad-c2a",
  "history": [
    {"role":"user","content":"给我道德经的第一章"},
    {"role":"assistant","content":"道可道，非常道；名可名，非常名。无名，天地之始；有名，万物之母。故常无欲，以观其妙；常有欲，以观其徼。此两者同出而异名，同谓之玄。玄之又玄，众妙之门。"}
  ]
}
EOF
run_case "case2a · D 验证 · 给他的原文的解释" "$TMP/c2a.json"
echo "  ⓘ 看完整答案：cat $TMP/case2a*.sse | grep '\"content\"' | head -20"
echo "  期望关键字：白话 / 释义 / 可以用言语说出 / 句号分行；不应出现 '知识库中没有'。"

# ── case2b：condense 不该触发（history 为空） ──────────────────────────────
cat > "$TMP/c2b.json" <<'EOF'
{
  "question": "什么是道？",
  "session_id": "test-ad-c2b",
  "history": []
}
EOF
run_case "case2b · 空 history · 什么是道？" "$TMP/c2b.json"
echo "  期望：不应出现 🪄（condense 不触发，history 为空）"

# ── 把每个 case 的完整答案 dump 出来 ────────────────────────────────────────
dump_answer() {
  local label="$1" file="$2"
  echo
  echo "─── 完整答案 · $label ───"
  python3 - "$file" <<'PY'
import json, sys, pathlib
parts = []
for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8').splitlines():
    if not line.startswith('data: '): continue
    try:
        o = json.loads(line[6:])
    except Exception:
        continue
    if o.get('type') == 'content' and isinstance(o.get('text'), str):
        parts.append(o['text'])
print(''.join(parts) if parts else '(no content emitted)')
PY
}

# 找文件名（含中文 + 空格，必须 quote）
C1A="$(ls "$TMP"/case1a*.sse 2>/dev/null | head -1 || true)"
C2A="$(ls "$TMP"/case2a*.sse 2>/dev/null | head -1 || true)"
C2B="$(ls "$TMP"/case2b*.sse 2>/dev/null | head -1 || true)"
[ -n "$C1A" ] && dump_answer "case1a · 那你把原文发我" "$C1A"
[ -n "$C2A" ] && dump_answer "case2a · 给他的原文的解释（D 验证）" "$C2A"
[ -n "$C2B" ] && dump_answer "case2b · 什么是道？（空 history 对照）" "$C2B"

echo
echo "═══════════════════════════════════════"
echo "SSE 原始文件保留在: $TMP"
ls -la "$TMP"
