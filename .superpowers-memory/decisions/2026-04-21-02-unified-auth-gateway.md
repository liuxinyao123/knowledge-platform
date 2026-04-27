# ADR 2026-04-21-02 · 统一授权服务采用 qa-service 内中间件 + 双栈 token

## Context

架构图「统一授权服务」方块目前只有 `metadata_acl_rule` 骨架表，无规则解释器、
无请求级 Principal、无路由级拦截、无结果脱敏。

Q-001（RBAC Token 是否统一走 BookStack OIDC）尚未收敛，直接绑一套 token 方案
会把选择绑死。

## Decision

1. **授权实施位置** = qa-service Express 中间件（非独立 gateway 服务）
2. **Token 验签** = 双栈配置：`AUTH_JWKS_URL` 或 `AUTH_HS256_SECRET`，二选一；
   生产环境（`NODE_ENV=production`）启动时若两者皆缺则 fail-fast
3. **Principal 形状** = `{user_id, email, roles[]}`
4. **规则引擎** = 读 `metadata_acl_rule`；deny-by-default；多规则 union 语义
5. **Decision 形状** = `{allow, filter?: SqlFragment, mask?: FieldMask[]}`
6. **缓存** = 进程内 lru-cache，TTL 10s；Admin API 可手动 flush
7. **DEV BYPASS** = 非生产且未配置时，注入 `roles=['admin']` 并打 WARN

## Consequences

**正面**
- 无新服务，运维简单
- Q-001 未收敛前仍可先行
- 下游（MCP / Agent / QA）统一消费 `req.principal` 与 `req.aclDecision`

**负面**
- 授权能力绑死 Node 层，未来跨语言需重写
- 大规模规则（千+）下 LRU 命中率存疑，需要后续 profile

## Links

- Proposal: `openspec/changes/unified-auth/proposal.md`
- Design:   `openspec/changes/unified-auth/design.md`
- Spec:     `openspec/changes/unified-auth/specs/unified-auth-spec.md`
- Tasks:    `openspec/changes/unified-auth/tasks.md`
- Open Question: `.superpowers-memory/open-questions.md#Q-001`
