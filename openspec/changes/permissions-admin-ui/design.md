# Design: permissions-admin-ui

## 后端

### POST /api/acl/rules/simulate

输入：
```json
{
  "principal": {
    "user_id": "demo",
    "roles": ["editor"],
    "permissions": ["knowledge:ops:manage"]
  },
  "action": "READ",
  "resource": {
    "source_id": 1,
    "asset_id": 42,
    "project_id": "T1"
  }
}
```

处理：
- 调 `evaluateAcl(principal, action, resource)` —— 同线上路径
- **不** 走 aclCache（每次真算一遍方便调试）
- 不写 audit_log
- 需要 `permission:manage`（用 `requireAuth() + enforceAcl(ADMIN)`，同现有 /api/acl 下）

输出：
```json
{
  "decision": {
    "allow": true,
    "filter": {"project_id": "T1"},
    "mask": [{"field": "cost_price", "mode": "star"}],
    "matchedRules": [12, 13]
  },
  "durationMs": 8
}
```

### GET /api/acl/users

MVP 返两条：
- 当前 DEV BYPASS 身份（从 `req.principal` 取）
- seed 行：`{user_id:'alice', roles:['admin']}`、`{user_id:'bob', roles:['editor']}`、`{user_id:'carol', roles:['viewer']}`

后续 G? 接真 IAM DB 时，换此接口实现即可。

### GET /api/acl/role-matrix

返 `ROLE_TO_PERMS` 导出版（列表格式方便渲染表头）：
```json
{
  "roles": ["admin","editor","viewer","user"],
  "permissions": ["knowledge:overview","knowledge:search", ...],
  "matrix": {
    "admin":  ["knowledge:overview", "...", "iam:manage"],
    "editor": ["knowledge:overview", "...", "knowledge:ops:manage"],
    ...
  }
}
```

### GET /api/acl/permissions

扁平列表：`{permissions: string[]}`。用于规则新建时 permission 下拉填充。

## 前端

### 导航：/iam

不进 KnowledgeTabs 主栏（主栏是"知识中台"功能，IAM 是管理员）。
Layout 侧边栏加独立 "🛡 管理" 分组，点"IAM"进入 `/iam`。

### knowledge/Iam/index.tsx

容器 + 3 Tab：
```
[规则] [用户] [权限矩阵]
```

Tab 切换走 URL query `?tab=rules|users|matrix`，默认 rules。

### RulesTab.tsx

- 列表：复用 `/api/acl/rules` GET
- 顶栏 [+ 新建规则] 按钮 → 打开 Modal
- 每行 [编辑] [Simulate] [删除] 三按钮
- Modal 包含：source_id, asset_id, role(下拉), permission(下拉 from /permissions), condition(JSON textarea)
- Simulate 子面板（右 drawer / 下方展开）：
  - 内嵌 principal 编辑器（user_id input + roles multi-select）
  - action 下拉 + resource 编辑（source_id / asset_id / project_id）
  - [运行] → 显示 allow/deny + filter + mask + matched rule IDs

### UsersTab.tsx

表格：user_id / email / roles(pill) / permissions(展开后数) / DEV_BYPASS 标记

### MatrixTab.tsx

表头：permissions（行）
表列：roles（列）
每格 ✓/✗（从 /role-matrix 的 matrix 字段读）
只读视图。

## 约束

- `RequirePermission name="permission:manage"` 包住 `/iam` 页，不是 admin 就显示 403
- 所有后端端点挂 enforceAcl(ADMIN)（复用 aclRouter.use），不用再单独加
