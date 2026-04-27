# Tasks: 统一授权服务

## 依赖与基础
- [x] BE-1: 新增 dep（未装 lru-cache/jose，以最小依赖实现：内置 `crypto` 做 HS256/RS256；手写轻量 LRU）
- [x] BE-2: `apps/qa-service/.env.example` 追加 `AUTH_JWKS_URL` / `AUTH_HS256_SECRET`（注释说明二选一 + DEV BYPASS 规则）

## Principal / Auth
- [x] BE-3: `src/auth/types.ts` — 落定 `Principal / AclAction / AclResource / FieldMask / SqlFragment / Decision / AclRuleRow`
- [x] BE-4: `src/auth/verifyToken.ts` — JWKS (RS256) 与 HS256 双栈实现（内置 crypto）
- [x] BE-5: `src/auth/requireAuth.ts` — 中间件；DEV BYPASS；生产 fail-fast；从 `knowledge_user_roles` 加载 roles
- [x] BE-6: 在 `src/index.ts` 启动时做 env 检查（生产模式缺 AUTH 配置 `process.exit(1)`）

## ACL 规则引擎
- [x] BE-7: `src/auth/evaluateAcl.ts` — 规则扫描、union 语义、resource 匹配、ADMIN 超集、mask 派生
- [x] BE-8: `src/auth/conditionEval.ts` — condition JSONB 谓词（eq/in/gt/lt/regex...）+ regex 50ms 超时
- [x] BE-9: `src/auth/filterDerive.ts` — source/asset 规则派生 `SqlFragment`
- [x] BE-10: `src/auth/aclCache.ts` — 手写轻量 LRU；max=2000 TTL=10s；flush 方法

## 中间件
- [x] BE-11: `src/auth/enforceAcl.ts` — `(opts) => RequestHandler`，挂 `req.aclDecision`/`req.aclFilter`
- [x] BE-12: `src/auth/shapeResult.ts` — mask 四种 mode 处理（hide/star/hash/truncate）

## 路由接入
- [x] BE-13: `/api/knowledge/search`、`/api/qa/ask` 均已挂 `requireAuth + enforceAcl('READ', source_id extractor)`
- [x] BE-14: `searchKnowledgeChunks` 接受 `aclFilter` 参数并注入 SQL WHERE（Round 1 已做基建，Round 2 接线）
- [x] BE-15: `/api/qa/ask` 的 `trace.citations` 经 `shapeResultByAcl` 整形后再 emit

## Admin API
- [x] BE-16: `src/routes/acl.ts` — CRUD + `POST /cache/flush`；全走 ADMIN 鉴权
- [x] BE-17: `src/index.ts` 挂载 `/api/acl` + 启动时 preload rules

## 契约资产
- [x] CT-1: `.superpowers-memory/integrations.md` 追加"Unified Auth Gateway"一节
- [x] CT-2: `.superpowers-memory/decisions/2026-04-21-02-unified-auth-gateway.md` 落 ADR（已产出）

## 测试（TDD 先行）
- [ ] TE-1: `__tests__/auth.verifyToken.test.ts` — ✅ HS256 路径完成；JWKS mock 暂留给后续回归集
- [x] TE-2: `__tests__/auth.requireAuth.test.ts` — 401 / DEV BYPASS / principal 注入
- [x] TE-3: `__tests__/auth.evaluateAcl.test.ts` — 规则矩阵（空/NULL/union/ADMIN/condition/filter 派生/mask）
- [x] TE-4: `__tests__/auth.conditionEval.test.ts` — 叶子谓词 + regex 无效正则兜底
- [x] TE-5: `__tests__/auth.filterDerive.test.ts` — 三级规则派生 SQL
- [ ] TE-6: `__tests__/auth.enforceAcl.test.ts` — 暂以 route 集成测试代替（留给 Round 3 整合）
- [x] TE-7: `__tests__/auth.shapeResult.test.ts` — hide/star/hash/truncate
- [ ] TE-8: `__tests__/acl.routes.test.ts` — 留给 Round 3 整合（需启动完整 app + PG mock）

- [x] 辅助：`__tests__/auth.aclCache.test.ts` — LRU key / 缓存/flush

## 验证
- [ ] VR-1: `pnpm -r test` 全绿（本机验）
- [x] VR-2: `tsc --noEmit` 无新 TS 报错（仅残留 pre-existing 的 pdf-parse default import）
- [ ] VR-3: 端到端：插 3 条规则，分别用 admin/editor/viewer token 打 `/api/knowledge/search`
- [ ] VR-4: 归档 `docs/superpowers/specs/unified-auth/` → `docs/superpowers/archive/unified-auth/`
