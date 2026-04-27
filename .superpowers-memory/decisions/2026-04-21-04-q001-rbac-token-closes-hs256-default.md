# ADR 2026-04-21-04 · 关闭 Q-001：RBAC Token 默认走 HS256，延后接入 BookStack OIDC

## Context

Open Question **Q-001**：RBAC Token 是否统一走 BookStack OIDC？

unified-auth change（`openspec/changes/unified-auth/`）上线后，本服务支持双栈：
- `AUTH_JWKS_URL`（OIDC / Keycloak）
- `AUTH_HS256_SECRET`（独立 HS256）

当前 BookStack 默认安装**未启用 OIDC**；启用需要改 `app/Config/auth.php`、
配 OIDC Provider、客户端 ID / Secret，且会影响现有 BookStack 用户登录体验。

## Decision

**Phase 1（当前）**：生产环境统一采用 `AUTH_HS256_SECRET` 方案。
- BookStack 仍然用自带登录；
- qa-service 拿到 BookStack user_id 后，在 `knowledge_user_roles` 里维护角色；
- JWT 由 qa-service 或上层 Portal 自签；`sub` = BookStack user_id，`email` 取自 BookStack；
- HS256 secret 存在各部署环境变量里，不入库、不日志。

**Phase 2（延后，触发条件：需要 SSO / 多方外部登录）**：切 OIDC。
- 启用 BookStack OIDC，或引入独立 IdP（Keycloak / Authelia）；
- qa-service 的 `AUTH_JWKS_URL` 指向 IdP；
- 不破坏现有 Principal / ACL 接口；只是 token 验签路径切换。

**开发环境**：沿用 DEV BYPASS（`NODE_ENV !== production` 且两配置皆空 → admin 注入）。

## Consequences

**正面**
- 马上可用；不阻塞 unified-auth / agent-orchestrator 上线
- 切到 OIDC 时零业务代码改动（只换 env）

**负面 / 取舍**
- HS256 密钥泄露 = 全票通用；密钥管理要规范（建议每部署环境独立 secret，定期轮换）
- 多系统 SSO 场景下最终还是要走 OIDC；本决策是阶段性

## Links

- unified-auth: `openspec/changes/unified-auth/`
- requireAuth 实现: `apps/qa-service/src/auth/requireAuth.ts`
- 关闭的问题: `.superpowers-memory/open-questions.md#Q-001`
