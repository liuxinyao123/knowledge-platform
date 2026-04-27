# Proposal: 统一授权服务（Unified Auth Gateway）

## Problem

架构图中「智能编排与治理层」的**统一授权服务**整个方块当前只有骨架：

- `knowledge_user_roles`（MySQL）仅存角色，没有 ACL 规则引擎；
- `metadata_acl_rule`（pgvector DB）表已建，**读取/评估逻辑完全没写**；
- `/api/knowledge/search`、`/api/qa/ask`、`/api/governance/*` 前**没有鉴权中间件**；
- 查询后也没有基于角色的**结果脱敏/过滤**。

下游 MCP（`openspec/changes/mcp-service/`）和 Agent 编排层
（`openspec/changes/agent-orchestrator/`）都需要"调用方 → 被允许做什么"的统一答案。

## Scope（本 Change）

1. **Principal 解析中间件** `requireAuth`
   - 从 `Authorization: Bearer <jwt>` 头解析，产出 `Principal = {user_id, email, roles[]}`
   - 角色来源：`knowledge_user_roles`（延用现有表）
   - 无 token / token 失效 → 401
2. **ACL 规则引擎** `evaluateAcl(principal, action, resource) → Decision`
   - Resource 支持三级：`{source_id?, asset_id?, field_id?}`（从粗到细匹配）
   - Action：`READ | WRITE | DELETE | ADMIN`
   - 规则源：`metadata_acl_rule` 表
   - Decision：`{allow: boolean, filter?: SqlFragment, mask?: FieldMask[]}`
   - **deny by default**
3. **查询前强制授权** 中间件 `enforceAcl({action, resourceExtractor})`
   - 应用到 `/api/knowledge/search`、`/api/knowledge/documents`、`/api/asset-directory/*`
   - 拒绝时返 403；允许但带 filter 时把 filter 挂到 `req.aclFilter`
4. **查询后结果整形** 工具 `shapeResultByAcl(decision, rows)`
   - 字段级掩码：按 `decision.mask` 把某些字段替换为 `"***"` 或删除
   - 用于文档内容、metadata_field 结果
5. **Admin 管理 API**（仅 `ADMIN` 角色可用）
   - `GET  /api/acl/rules`
   - `POST /api/acl/rules` / `PUT /api/acl/rules/:id` / `DELETE /api/acl/rules/:id`
6. **10 秒 TTL 的进程内缓存**：按 `principal_id + resource_key` 缓存 decision，避免
   每次查询都重新评估规则。

## Out of Scope（后续 Change）

- **身份来源**：token 由谁签（BookStack OIDC vs 独立 JWT）属于 Q-001，本 change
  不决定；`requireAuth` 只规定 token 的解析形式，签发方通过 `AUTH_JWKS_URL` /
  `AUTH_PUBLIC_KEY` env 注入。
- 行级安全（RLS）接入 pgvector 本身。
- 多租户 / 组织树。
- UI 侧的 ACL 配置面板（P2）。

## 决策记录

- D-001 Principal 形状固定为 `{user_id, email, roles[]}`；roles 为字符串数组。
- D-002 Resource 层次固定为 `source_id > asset_id > field_id`；匹配最具体的一条生效。
- D-003 多条规则冲突时，**任一 allow 即 allow**（union 语义）；没有显式 deny。
- D-004 ACL 评估结果 TTL = 10s 的进程内 LRU；规则变更需重启服务或调
  `POST /api/acl/cache/flush`。
- D-005 本 change 不引入新 DB 表；`metadata_acl_rule` 已够用。
