# ADR 2026-04-21-12 · 权限规则编辑器 + IAM 面板（PRD §11-13 + §15）

## Context

PRD §11-13 权限规则编辑器、§15 IAM 面板的 UI 缺。G1 后端 CRUD 已全，G2 permissions 模型已合并进 Principal。

Q4=b：登录继续 DEV BYPASS，IAM 只做"看板"。

## Decision

1. G3 + G4 合并为 `permissions-admin-ui`，共用 `/iam` 路由与 `/api/acl` 后端
2. 后端只加"读"+"模拟"4 个轻量端点，不动数据模型
3. 用户列表 mock：DEV BYPASS 当前身份 + 3 个 seed；未来接 IAM DB 换实现
4. 规则 Simulate 调 `evaluateAcl()` 同线上逻辑，但 skip cache + skip audit
5. `/iam` 用 `<RequirePermission name="permission:manage">` 包，editor/viewer 直接 403
6. 侧边栏新加 "管理" 分组放 IAM；不进 KnowledgeTabs 主栏

## Consequences

**正面**
- 管理员终于能点 UI 管规则；不用再 psql
- Simulate 减少误配置（上线前试算）
- PRD §11-13/§15 UI 100% 落地

**负面 / 取舍**
- 用户新增/改密仍得手动 —— Q4=b 接受
- role-matrix 是常量快照，修改 `permissions.ts` 需重启服务才看到
- Simulate 不写 audit —— 可能被滥用来探测规则；后续若开放到 editor 需加 rate limit

## Links

- openspec/changes/permissions-admin-ui/
- PRD §11-13 规则编辑器 / §15 IAM
- ADR 2026-04-21-10 unified-auth-permissions（G2 permission 模型）
