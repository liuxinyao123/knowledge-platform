# Proposal: permissions-admin-ui (G3 + G4)

## 背景

PRD §11-13 权限规则编辑器 + §15 IAM 面板 —— 两者都建在 G1（ACL 后端）+ G2（unified-auth-permissions）之上，UI 还缺。

- **G3 规则编辑器**：list/edit/simulate metadata_acl_rule；无需新增数据模型
- **G4 IAM 面板**：展示用户、角色、权限矩阵；Q4=b 登录继续 DEV BYPASS，只做"看板"不做用户新增/改密

合并成一个 change —— 两者共享路由 `/iam`、共用 `/api/acl` 后端。

## 动机

- PRD §11-13/§15 UI 未落地；管理员目前只能手动 SQL 管理规则
- G1 已提供 CRUD API，但没人能点到；G2 已有 `expandRolesToPermissions()`，没地方展示
- 未来 IAM 升级到 DB 可编辑用户时，本 change 的"读"路径复用

## 范围

### IN

- 后端新增：
  - `POST /api/acl/rules/simulate` —— 试算 Decision（不写库）
  - `GET /api/acl/users` —— 返当前系统已知身份（DEV BYPASS + seeded）
  - `GET /api/acl/role-matrix` —— 返 ROLE_TO_PERMS 常量快照
  - `GET /api/acl/permissions` —— 返全量 permission 字符串列表
- 前端新增：
  - `/iam` 入口（单独 Route，不进 KnowledgeTabs 主栏；Layout 侧边栏加"管理"分组）
  - 3 Tab：规则 / 用户 / 权限矩阵
  - 规则 Tab：列表 + 新建/编辑 Modal + Simulate 面板
  - 用户 Tab：表格展示 roles / 映射的 permissions / DEV BYPASS 提示
  - 权限矩阵 Tab：角色 × 权限的 checkbox 矩阵（只读）

### OUT

- 用户增删改 —— Q4=b 决策：DEV BYPASS 保留，未来再做
- 规则导入/导出 —— Phase 2
- 角色自定义 —— 保持 admin/editor/viewer/user 四档常量
- 规则级 audit 专用视图 —— 复用治理 audit_log 面板

## 决策依赖

- Q4=b（2026-04-21）：IAM 面板只读展示，登录继续 DEV BYPASS
- Q5=a（2026-04-21 G2）：permission 已合并进 Principal（本 change 直接消费）

## 验证

- `tsc --noEmit` 双 0
- 手动 /iam 三 Tab 切换，simulate 命中规则返 allow=true / unmatched 返 allow=false
