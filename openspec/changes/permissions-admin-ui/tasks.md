# Tasks: permissions-admin-ui

## 后端
- [x] BE-1: `routes/acl.ts` 加 `POST /rules/simulate`
- [x] BE-2: `routes/acl.ts` 加 `GET /users`（mock + DEV BYPASS 身份）
- [x] BE-3: `routes/acl.ts` 加 `GET /role-matrix`
- [x] BE-4: `routes/acl.ts` 加 `GET /permissions`
- [x] BE-5(追加): `auth/types.ts` + `evaluateAcl.ts` 加可选 `matchedRuleIds` 字段

## 前端 API
- [x] FE-1: `api/iam.ts` 新文件 —— 5 个接口封装（rule CRUD / simulate / users / matrix / permissions）

## 前端组件
- [x] FE-2: `knowledge/Iam/index.tsx` —— 容器 + 3 Tab，URL query ?tab=
- [x] FE-3: `knowledge/Iam/RulesTab.tsx` —— 列表 + 新建/编辑 Modal + Simulate Drawer
- [x] FE-4: `knowledge/Iam/UsersTab.tsx` —— 用户表格
- [x] FE-5: `knowledge/Iam/MatrixTab.tsx` —— 角色 × 权限矩阵
- [x] FE-6: `App.tsx` 加 `/iam` 路由（RequirePermission 在 Iam/index.tsx 内部包）
- [x] FE-7: `components/Layout.tsx` 侧边栏加"管理 > IAM"入口（RequirePermission 包）
- [x] FE-8(追加): Layout 侧边栏补"资产目录"入口

## 契约
- [x] CT-1: `.superpowers-memory/decisions/2026-04-21-12-permissions-admin-ui.md`

## 验证
- [x] VR-1: `tsc --noEmit` 双 0（apps/web + apps/qa-service）
- [ ] VR-2: 手动 /iam 3 Tab 切换
- [ ] VR-3: Simulate 命中/未命中两次跑
- [ ] VR-4: editor 身份访问 /iam 看到 403
- [x] VR-5: 归档 —— docs/superpowers/archive/permissions-admin-ui/
