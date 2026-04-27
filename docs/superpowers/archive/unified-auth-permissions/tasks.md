# Tasks: unified-auth permissions 升级

## 后端
- [x] BE-1: `auth/permissions.ts` —— PRD §2.3 内置映射 + `expandRolesToPermissions` + `hasPermission`
- [x] BE-2: `auth/types.ts` —— Principal 加 `permissions: string[]`
- [x] BE-3: `auth/verifyToken.ts` —— TokenPayload 加 `permissions? roles?`
- [x] BE-4: `auth/requireAuth.ts` —— 合并 permissions 逻辑；DEV BYPASS 注入 ADMIN_PERMS
- [x] BE-5: `auth/enforceAcl.ts` —— 加 `requiredPermission` 选项；DEV BYPASS 放行
- [x] BE-6: `auth/evaluateAcl.ts` —— 支持 `permission_required` 列
- [x] BE-7: `pgDb.ts` —— `ALTER TABLE metadata_acl_rule ADD COLUMN IF NOT EXISTS permission_required VARCHAR(64)`
- [x] BE-8: `routes/auth.ts` —— `/api/auth/me`
- [x] BE-9: `index.ts` —— 挂载 `/api/auth`

## 前端
- [x] FE-1: `api/auth.ts` —— whoami()
- [x] FE-2: `auth/AuthContext.tsx` —— AuthProvider + useAuth
- [x] FE-3: `auth/RequirePermission.tsx` —— 权限条件渲染
- [x] FE-4: `main.tsx` —— 挂 AuthProvider
- [x] FE-5: Governance 页的 `dataperm` Tab 用 `<RequirePermission name="permission:manage">` 包裹（示范用法）

## 测试
- [x] TE-1: `auth.permissions.test.ts` —— 常量 / 展开 / hasPermission
- [x] TE-2: `auth.requireAuth.permissions.test.ts` —— token claim 优先 / 展开 / DEV
- [x] TE-3: `auth.enforceAcl.permissions.test.ts` —— 通过 / 拒绝 / DEV

## 契约
- [x] CT-1: `.superpowers-memory/decisions/2026-04-21-10-unified-auth-permissions.md`
- [x] CT-2: `.superpowers-memory/integrations.md` 追加 "Permissions 模型"

## 验证
- [x] VR-1: `pnpm -r test` 全绿
- [x] VR-2: `tsc --noEmit` 零错
- [x] VR-3: 本机 `curl /api/auth/me` 返 DEV admin + 全权限
- [x] VR-4: 前端启动后 `<RequirePermission>` 对应元素可见/隐藏
- [x] VR-5: 归档
