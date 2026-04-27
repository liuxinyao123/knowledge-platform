# Explore Draft — 统一授权服务

> 本文件是 Explore 阶段草稿。正式契约见 `openspec/changes/unified-auth/`。
> 不进主分支，或以 PR draft 状态存在。

## 读的代码

- `apps/qa-service/src/services/pgDb.ts:71` — `metadata_acl_rule` 表已建，仅骨架（id, asset_id, source_id, role, permission, condition JSONB, created_at）
- `apps/qa-service/src/services/db.ts` — `knowledge_user_roles` MySQL 表，含 user_id + role
- `apps/qa-service/src/routes/governance.ts` — 已有 `/api/governance/users` 维护角色
- 无任何路由加鉴权中间件（grep `requireAuth / authMiddleware` 零命中）

## 观察到的 gap

1. 角色表有、规则表有，但**缺"规则解释器"**（evaluateAcl）
2. 缺**请求级 Principal 注入**（JWT 验签 → user_id + roles）
3. 缺**统一挂钩点**：`/api/knowledge/*`、`/api/qa/*` 全裸奔
4. 缺**结果整形**：field mask 对应图中"查询后结果整形"
5. Q-001 尚未收敛，token 签发方悬而未决 → 用双栈配置规避

## 候选方案评估

| 方案 | 代价 | 风险 | 评分 |
|------|------|------|------|
| A 独立 auth-gateway 服务（Envoy/Traefik） | 高（新服务） | 运维复杂 | ✗ |
| B qa-service 内中间件（本 change 采用） | 中 | 能力绑死在 Node | ✓ |
| C 前端校验为主 | 低 | 安全漏洞 | ✗ |

**选择 B**：中间件内嵌，代价与收益平衡；后续可抽成独立服务。

## 风险 / 未决

- Token 签发方（Q-001）：双栈兜底 JWKS / HS256
- 规则规模：初期几十条 LRU 够；上千条要加索引
- DEV BYPASS 要防误带上生产：`NODE_ENV=production` fail-fast
