# Explore Draft — unified-auth permissions 升级

> 草稿。正式契约见 `openspec/changes/unified-auth-permissions/`。

## 读的代码

- 现有 `auth/types.ts` Principal 仅有 `roles[]`
- ACL 规则按 role 字段过滤；无法表达 PRD 的 `knowledge:ops:manage` 这种细粒度
- 前端无任何"我是谁/有哪些权限"接口
- PRD §17.4 要求 `data-requires` 隐式管控 UI 可见性

## 候选方案评估

| 方案 | 代价 | 风险 | 评分 |
|------|------|------|------|
| A 完全重做 ACL 模型 | 高 | 既有规则全要迁 | ✗ |
| B 增量加 permissions 字段 + 兼容 role-based ACL（本 change 采用） | 中 | 双轨期可能复杂 | ✓ |
| C 全 permission，删 role | 高 | 与 BookStack 集成的 role 数据冲突 | ✗ |

**选 B**：增量、向后兼容、PRD §2.5 "permissions 优先"自然落地。

## 风险

- DEV BYPASS 给全集 → 本地"误觉得有权"；生产 fail-fast 会暴露问题
- 内置 ROLE_TO_PERMS 与 IAM 5 Tab DB 配置未来要合并；约定本 change 是 stub，G4 升级
