# OpenViking sidecar — Agent 上下文数据库
#
# 设计目标：
#   - 自建 Dockerfile（非 quay.io 官方镜像），可锁版本、可控 entrypoint
#   - 让 OpenViking 复用我们已有的硅基 Qwen，避免外网 OpenAI
#   - 数据落到 /data（外挂 volume），重启不丢
#
# 镜像约 200MB（slim + pip 依赖）
# 关闭 buildx cache 后冷构建约 3-4 分钟（受网络影响）

FROM python:3.11-slim AS base

# 系统依赖：openviking 内部用 sqlite + 可选 git，slim 缺这些会运行期报错
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      sqlite3 \
 && rm -rf /var/lib/apt/lists/*

# 不用 root 跑
RUN useradd -m -u 1933 -s /bin/bash viking
WORKDIR /home/viking

# pip 依赖：锁住 openviking 主版本
# 首版用 0.2.x（v0.2.5 是当前 release 主线）
ARG OPENVIKING_VERSION=0.2.5
ENV PIP_NO_CACHE_DIR=1
RUN pip install --upgrade pip \
 && pip install "openviking==${OPENVIKING_VERSION}"

# 数据目录 + 容器内文件结构
RUN mkdir -p /data && chown -R viking:viking /data /home/viking

COPY --chown=viking:viking entrypoint.sh /home/viking/entrypoint.sh
RUN chmod +x /home/viking/entrypoint.sh

USER viking

EXPOSE 1933

# 默认 healthcheck —— 由 docker-compose 接管也行，这里给个保险
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=10 \
  CMD curl --fail --silent --max-time 3 http://127.0.0.1:1933/healthz || exit 1

ENTRYPOINT ["/home/viking/entrypoint.sh"]
