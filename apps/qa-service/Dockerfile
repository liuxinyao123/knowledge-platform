# Monorepo 根目录为构建上下文：docker compose -f infra/docker-compose.yml build
FROM node:22-bookworm-slim

# PDF Pipeline v2 需要 Java 11+ (opendataloader-pdf 内部用 Java CLI)
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jre-headless ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/qa-service/package.json ./apps/qa-service/

RUN pnpm install --frozen-lockfile --filter qa-service...

COPY apps/qa-service ./apps/qa-service

WORKDIR /app
ENV PORT=3001
EXPOSE 3001

# 使用与本地一致的 dev 入口（Node 22 strip-types）；生产可再改为 tsc 构建产物
CMD ["pnpm", "--filter", "qa-service", "run", "dev"]
