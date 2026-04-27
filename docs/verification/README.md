# 端到端权限验证 · 快速上手

这个目录装端到端验证物：目前只有 RBAC / permission 链路。

## 文件

- `e2e-permissions-matrix.md` —— 每个受保护端点 × 角色 的期望矩阵，以及 DEV BYPASS / deny-by-default 两个坑的说明
- 配套脚本：`scripts/verify-permissions.mjs`（仓库根 scripts 下）

## 15 分钟走完一遍

### 1. 起服务（本机）

```bash
cd /Users/xinyao/Git/knowledge-platform
pnpm dev:up
```

### 2. 确保 `AUTH_HS256_SECRET` 已配

在 `apps/qa-service/.env` 或仓库根 `.env` 里有：

```
AUTH_HS256_SECRET=<任何 ≥16 字符的字符串>
```

没配的话：`/api/auth/login` 返 500，且所有请求会走 DEV BYPASS（全部变 admin），403 路径永远测不出来。
改完后重启 qa-service：`pnpm dev:down && pnpm dev:up`。

### 3. seed editor + viewer 测试用户

```bash
node scripts/verify-permissions.mjs --seed
```

幂等：已经存在会打印 `exists`，不会报错。默认邮箱/密码：
- `editor@dsclaw.local / editor1234`
- `viewer@dsclaw.local / viewer1234`

### 4. 跑断言

```bash
node scripts/verify-permissions.mjs
```

会打印每个请求的 `[PASS|FAIL]` 行，末尾 `N/M passed` 汇总；
有任何 FAIL 退出码非 0，方便挂 CI。

### 5. 浏览器手验前端守卫

脚本最后会打印 6 条检查清单，用 3 个无痕窗口分别登三人过一遍：
- 侧栏「管理」分组是否按角色显示/隐藏
- `/iam` 和 `/governance → 数据权限` 是否给 editor/viewer 展示锁屏 fallback
- 顶栏「修改密码」三人都该能用

## 常见问题排查

| 症状 | 原因 | 修法 |
|---|---|---|
| `登录失败：login admin@dsclaw.local failed: 500` | `AUTH_HS256_SECRET` 没配 | 参考上面第 2 步 |
| `登录失败：login editor@dsclaw.local failed: 401` | 没 seed editor/viewer | 先跑 `--seed` |
| admin 访问 `/api/governance/tags` 也 FAIL 403 | `metadata_acl_rule` 表空；deny-by-default | 参考 matrix 文档 §4.3 的 SQL 兜底规则，插完后 `POST /api/acl/cache/flush` |
| editor / viewer 访问 admin 端点是 200 不是 403 | DEV BYPASS 开着了 | 检查 `AUTH_HS256_SECRET` 是否真的被加载（qa-service 启动日志 `auth=hs256` 而不是 `dev`） |

## 只跑局部

```bash
# 只跑不依赖 metadata_acl_rule 的断言（最快、最稳）
node scripts/verify-permissions.mjs --only required-perm

# 只跑 action+resource 门（前提：表已 seed）
node scripts/verify-permissions.mjs --only acl-resource

# 只跑 requireAuth 类（mcp/stats, ingest/recent）
node scripts/verify-permissions.mjs --only auth-only

# 只打印前端手动清单
node scripts/verify-permissions.mjs --only frontend-hints
```

## 跑完后的动作

1. 若全 PASS：把本次结果贴进 `.superpowers-memory/PROGRESS-SNAPSHOT-2026-04-22.md`，关掉"端到端权限验证"的 VR 项
2. 若有 FAIL：逐条核对 `e2e-permissions-matrix.md` 的 followups §六，开新的 change proposal 修
