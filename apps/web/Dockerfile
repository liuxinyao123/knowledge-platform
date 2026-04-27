# apps/web/Dockerfile —— Vite 构建 + nginx 静态托管 + 反代 /api/* → qa_service
#
# 构建上下文 = monorepo 根（与 qa-service Dockerfile 同款）：
#   docker compose -f infra/docker-compose.yml build web
#
# Stage 1: build —— pnpm install + tsc -b + vite build → dist/
# Stage 2: serve —— nginx:alpine + 自定义 conf + 把 dist 拷到 /usr/share/nginx/html

# ---------- Stage 1: build ----------
FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

# 依赖先拷（max 缓存命中）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/

# 装 web 依赖（含 transitive workspace 链接）
RUN pnpm install --frozen-lockfile --filter web...

# 拷源码 + 构建
COPY apps/web ./apps/web
RUN pnpm --filter web build

# ---------- Stage 2: serve ----------
FROM nginx:alpine

# 用我们的 nginx 配置（SPA 路由 + /api 反代 + SSE 兼容）
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# 把构建产物拷到 nginx 默认根
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

# nginx:alpine 镜像 default CMD = nginx -g 'daemon off;'，不用重写
