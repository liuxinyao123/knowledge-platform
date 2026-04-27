# Tasks: 用户权限体系

## 后端

- [x] 创建 `apps/qa-service/src/services/db.ts`（mysql2 连接池 + CREATE TABLE IF NOT EXISTS）
- [x] 创建 `apps/qa-service/src/routes/governance.ts`（4 个端点）
- [x] 更新 `apps/qa-service/src/index.ts`（挂载 governanceRouter）
- [x] 更新 `apps/qa-service/.env.example`（添加 DB_* 变量）
- [x] 编写后端测试 `apps/qa-service/src/__tests__/governance.test.ts`

## 前端

- [x] 创建 `apps/web/src/api/governance.ts`（govApi client）
- [x] 更新 `apps/web/vite.config.ts`（添加 /api/governance 代理）
- [x] 重构 `apps/web/src/knowledge/Governance/index.tsx`（MembersTab + SpacesTab）
- [x] 编写前端测试 `apps/web/src/knowledge/Governance/index.test.tsx`

## 验证

- [ ] 后端测试全部通过
- [ ] 前端测试全部通过
- [ ] TypeScript 编译无报错
