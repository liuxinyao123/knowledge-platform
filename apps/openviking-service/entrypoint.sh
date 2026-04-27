#!/usr/bin/env bash
# OpenViking sidecar entrypoint
#
# 注入硅基（OpenAI 兼容）配置后再 exec ov serve。
# 所有变量都有默认值，启动时打印一次便于排障。

set -eo pipefail

# ── LLM provider ───────────────────────────────────────────────
# OpenViking 自身用的是 OPENAI_* 系列（OpenAI 兼容协议）
# 我们把 EMBEDDING_BASE_URL / EMBEDDING_API_KEY 透传过去，复用硅基账号
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-${EMBEDDING_BASE_URL:-https://api.siliconflow.cn/v1}}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-${EMBEDDING_API_KEY:-}}"
export OPENAI_MODEL="${OPENAI_MODEL:-Qwen/Qwen2.5-72B-Instruct}"
export OPENAI_EMBEDDING_MODEL="${OPENAI_EMBEDDING_MODEL:-Qwen/Qwen3-Embedding-8B}"

# ── 服务 ────────────────────────────────────────────────────────
export VIKING_HOST="${VIKING_HOST:-0.0.0.0}"
export VIKING_PORT="${VIKING_PORT:-1933}"
export VIKING_DATA_DIR="${VIKING_DATA_DIR:-/data}"

# 可选：自定义 root key（不设则首次启动自动生成并打印到日志）
# 注意：本机 dev 留空走"无认证"，生产必须设
export VIKING_ROOT_KEY="${VIKING_ROOT_KEY:-}"

mkdir -p "${VIKING_DATA_DIR}"

# ── 启动横幅 ────────────────────────────────────────────────────
cat <<EOF
============================================================
 OpenViking sidecar starting
   listen      ${VIKING_HOST}:${VIKING_PORT}
   data dir    ${VIKING_DATA_DIR}
   llm base    ${OPENAI_BASE_URL}
   llm model   ${OPENAI_MODEL}
   embed model ${OPENAI_EMBEDDING_MODEL}
   api key set $([ -n "${OPENAI_API_KEY}" ] && echo yes || echo NO)
============================================================
EOF

# ov 是 openviking 包提供的 CLI（v0.2.x）。如以后命令行变化，改这里即可
# 若 ov 不存在，fall back 到 python -m openviking
if command -v ov >/dev/null 2>&1; then
  exec ov serve \
    --host "${VIKING_HOST}" \
    --port "${VIKING_PORT}" \
    --data-dir "${VIKING_DATA_DIR}"
else
  echo "[entrypoint] ov CLI not found, falling back to python -m openviking" >&2
  exec python -m openviking serve \
    --host "${VIKING_HOST}" \
    --port "${VIKING_PORT}" \
    --data-dir "${VIKING_DATA_DIR}"
fi
