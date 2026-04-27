# Progress Snapshot · 2026-04-23

> 本日双线：上午 permissions-v2 走完工作流 B 剩余 3 阶段；下午接 24 条 bug 报告分 5 批清完，其中核心 BUG-01 走完整工作流 B + 补 D-007 short-circuit 补丁。

## 一、Permissions V2 · Lock + Execute + Archive ✅

> 选型：工作流 B `superpowers-openspec-execution-workflow`
> 上一站：`PROGRESS-SNAPSHOT-2026-04-22.md` §八（V2 选型 + 代码落地 + 双 tsc 通过）+ ADR `2026-04-22-16-permissions-v2.md`

### 1. Explore（对齐）

- 输入：ADR + V1 三份上游 ADR + PROGRESS-SNAPSHOT §八
- 输出：`docs/superpowers/archive/permissions-v2/design.md`（已归档）
- 核心发现：**V2 代码已落地**，真正要做的是"行为冻结 + Followups 收口"
- 用户三项决策：
  - F-1 冒烟放到 Execute 最后环节
  - R-1 写"双轨"（新装机严格 / 升级兼容 + WARN 一次）
  - Scope 选中等：V2 冻结 + F-3 审计 + F-2 Spaces/Assets 抽屉
  - F-3 用新表 `acl_rule_audit`（不复用 audit_log）

### 2. Lock（OpenSpec 契约冻结）

`openspec/changes/permissions-v2/`

- `proposal.md` / `design.md` / `tasks.md`
- `specs/acl-v2-spec.md`（subject × 8 + notExpired × 4 + deny × 4 + asset 继承 × 2 + R-1 双轨 × 4）
- `specs/notebook-sharing-spec.md`（accessibility + GET 分段 + members CRUD + role 归一化）
- `specs/acl-audit-spec.md`（表结构 + 写入 + GET /audit + AuditTab）
- `specs/permissions-drawer-spec.md`（入口 + Drawer 行为 + 作用域约束 + 无障碍）

Lock 期间 **对齐 5 处代码 vs spec drift**：PUT vs PATCH、notebook_member.role `editor|reader`、POST upsert、DELETE 路径参数、acl_rule_audit 与 writeAudit 并行关系。

### 3. Execute

实施计划：`docs/superpowers/plans/permissions-v2-impl-plan.md`

**新增文件（13）**
```
apps/qa-service/src/routes/iamAcl.ts                                       F-3 查询路由
apps/qa-service/src/__tests__/auth.evaluateAcl.v2.test.ts                  V2 评估单测
apps/qa-service/src/__tests__/pgDb.seed.test.ts                            R-1 双轨单测
apps/qa-service/src/__tests__/notebooks.accessibility.test.ts              notebook 集成测
apps/qa-service/src/__tests__/acl.audit.test.ts                            F-3 集成测
apps/web/src/api/iam.ts                                                    +listAclAudit / AuditRow
apps/web/src/knowledge/Iam/_shared/diffJson.ts + .test.ts                  结构化 diff
apps/web/src/knowledge/Iam/AuditTab.tsx                                    新 Tab
apps/web/src/knowledge/_shared/SubjectBadge.tsx                            主体徽标
apps/web/src/knowledge/_shared/PermissionsDrawer.tsx                       F-2 抽屉
apps/web/src/knowledge/Notebooks/ShareModal.test.tsx                       前端快照
```

**修改文件（6）**
```
apps/qa-service/src/services/pgDb.ts       + acl_rule_audit 表 + R-1 WARN 逻辑 + export for test
apps/qa-service/src/routes/acl.ts          + writeAclRuleAudit / loadRuleRow + 3 分支并行写
apps/qa-service/src/index.ts               + mount /api/iam/acl
apps/web/src/knowledge/Iam/index.tsx       5 Tab（+ 审计）；支持 ?tab=audit
apps/web/src/knowledge/SpaceTree/TreePane.tsx  行内 🔒 按钮 + RequirePermission
apps/web/src/knowledge/Assets/Detail.tsx   顶栏 🔒 按钮（替代原 navigate('/iam')）
```

### 4. 验证闸门

| 闸门 | 结果 |
|---|---|
| qa-service `tsc --noEmit` | ✅ EXIT=0 |
| qa-service `pnpm test`（用户本机） | ✅ 207/209 · **本 change 新测试 0 fail** |
| web `tsc --noEmit` | ⚠ 5 pre-existing 错误（RunDetail / ChatPanel · React 19 遗留）；本 change 新代码 0 错 |
| web `pnpm test` | ⏸ 用户待跑 |
| Migration 双轨 + 浏览器 6 步冒烟 | ⏸ 用户本机 · `docs/verification/permissions-v2-verify.md` §5 |

### 5. Archive

- `docs/superpowers/specs/permissions-v2/` → `docs/superpowers/archive/permissions-v2/`
- Lock 决策 ADR：`.superpowers-memory/decisions/2026-04-23-17-permissions-v2-lock.md`（D-001~D-004）

### 6. 不在本轮 scope

| 项 | 归类 | 去处 |
|---|---|---|
| C-FE-1/2/3 · RulesTab 抽 `<RuleForm>` + `useRuleMutations` | refactor | 独立 change（工作流 C） |
| web-react19-typefix（5 处 pre-existing 错误） | 修复 | 独立 change |
| tagextract-testfix（2 条测试 drift） | 修复 | 独立 change |
| F-4 / F-5 · /api/mcp 门 + governance 迁 requiredPermission | 收紧 | 独立 change |
| F-6 / F-7 / F-8 · 自定义角色 / 团队嵌套 / evaluateAcl 缓存 | V2.x | 工作流 A/B 另立项 |

---

## 二、未解 / Park · 增量

在 04-22 §七基础上新增 followup：

| 项 | 状态 | 备注 |
|---|---|---|
| RulesTab / Drawer 表单收敛 refactor | followup | 本轮 Drawer self-contained；下一轮抽组件 |
| web-react19-typefix | followup | RunDetail / ChatPanel 5 处错误 |
| tagextract-testfix | followup | 测试对齐 MAX_TAG_LEN=24 + 测试数据长度 |

**04-22 §七 里已在 V2 scope 里解决**：
- ~~F-3 审计日志~~ ✅（本轮 `acl_rule_audit`）
- ~~F-2 Spaces/Assets 权限抽屉~~ ✅（本轮 `PermissionsDrawer`）

---

## 三、Bug 批清（24 条，分 5 批，工作流 C+B 混合）

来源：2026/4/23 自动化测试报告。按根因分 A/B/C/D/E/F 六桶（E 单独最大）。

### 批 A · UI 小改（工作流 C · 8 条）· ADR `2026-04-23-18-bugbatch-a.md`

- BUG-03/04/15 Notebooks：标题"的"/永久"加载中…"/NaN 时间 → `displayName()` 兜底 + title 三分支 + 时间 NaN 守护
- BUG-18/19 Assets 面包屑 `/` → `›` 统一 + Layout `navItems` 补 `/agent` 条目
- BUG-20 "🔒 权限…" 省略号截断感 → "🔒 权限设置" + `whiteSpace: nowrap`
- BUG-23/24 SpaceTree / Eval 内部术语文案 → 用户语言重写

### 批 B · Tab / 表单（工作流 C · 6 条）· ADR `2026-04-23-19-bugbatch-b.md`

- BUG-05 IAM "权限规则" 永久"加载中…" → `RulesTab.catch` 加 `setRules([])`
- BUG-06 Tab active+hover 文字消失 → CSS `:not(.active):hover` + `.active:hover` 双保险
- BUG-08 搜索提交后仍显示空态 → debounce 等待期纳入 loading（`isTyping`）
- BUG-11 3 处表单空提交静默 → **统一方案**：去 `disabled` 字段校验，onClick 时 `setErr`
- BUG-12/13 ingest URL 空 + ZipImporter 灰按钮 → 同上方案；ZipImporter 加 tooltip

### 批 C · Mock / Dev 文案下架（工作流 C · 2 条）· ADR `2026-04-23-20-bugbatch-c.md`

- BUG-07 资产详情 "RAGFlow 已接入（演示数据...）" → "语义摘要预览（示例视图）"
- BUG-17 /mcp 6 处 `Q3=c` / `PRD §14` / `mock` → 用户语言
- **原则写入 ADR**：面向用户字符串禁 5 类内容（内部编号 / 未来时间承诺 / 文件路径 / 撒谎式夸大 / `mock` 作为独立单词）

### 批 D + F（工作流 C · 4+3 条）· ADR `2026-04-23-21-bugbatch-d-and-f.md`

- BUG-02 搜索暴露错误 JSON → `sanitizePreview()` 识别 `{"type":"error"}` 等特征替换
- BUG-14 OCR 碎片标签 → `cleanOne` 加 `looksLikeOcrFragment`（后在批 E 抽到 textHygiene 共享）
- BUG-16 总览缓存 5 分钟 → Overview 覆盖为 30s + `refetchOnMount: always`
- BUG-21 Top5 同名空间 → 同名时 `#<id>` 后缀区分（不 dedupe）
- BUG-09 侧栏搜索框 → 抽 `<SidebarSearch>`：Enter → `/search?q=...`；Search 页 `useSearchParams` 读初始值
- BUG-10 总览"导入知识"按钮 → **代码层正确**，加 `data-testid` 供本机复验；无实际代码改动
- BUG-22 空间页 2s 骨架屏 → 性能观察非 bug，未动代码

### 批 E · BUG-01 核心检索（工作流 B · 完整 Explore→Lock→Execute→Archive）

ADR `2026-04-23-22-rag-relevance-hygiene-lock.md`（D-001~D-007） · OpenSpec `openspec/changes/rag-relevance-hygiene/`

**根因收敛**（用户本机 curl SiliconFlow rerank 拿到决定性数据）：
- API 字段就是 `relevance_score`（代码匹配）→ 不是字段漂移
- 相关文档返 0.9996 / 无关返 1.66e-5 → API 正常
- UI `toFixed(2)` 把 1.66e-5 显示成 "0.00" → **显示层掩盖真实量级**
- 库里 chunk 大多 OCR 碎片 / JSON error body（批 D 同源）→ reranker 打超低分**正确**
- **答复两字截断**：LLM 被全乱码 context 毒化后卡住

**五层修复 + 补丁**：
- **A** `formatRelevanceScore` 三档显示（0.99 / 0.049 / 1.66e-5）+ `<ConfidenceBadge>` 四档 pill
- **B** `RELEVANCE_WARN_THRESHOLD=0.1`（env 可覆盖）触发 ⚠️ WARN
- **C** `textHygiene.ts` 共享 util（`looksLikeOcrFragment` 从 tagExtract 抽出 + 新增 `looksLikeErrorJsonBlob` + `isBadChunk`）；ingest pipeline L3 chunk gate
- **D** `cleanup-bad-chunks.sh`（bash SQL）+ `.mjs`（Node 扫 OCR）双脚本，dry-run + `--confirm`
- **D3** `chatStream` 空流守护：yielded=0 时 throw，错误冒泡前端不再静默截断
- **D-007 补丁**（晚间追加）：`NO_LLM_THRESHOLD=0.05`（env 可覆盖）short-circuit —— rerank top-1 低于阈值**直接跳过 LLM**，给预设兜底回答（"暂时没有…可能原因①②③…"）。解决用户截图里"知识"两字截断。

**交付**：后端 5 新 + 4 改；前端 3 新 + 3 改；脚本 2；测试 4 新（relevanceFormat / textHygiene / chatStream / shortCircuit 共 ~30 case）。

---

## 四、未解 / Followup · 截至日终

| 项 | 归类 | 备注 |
|---|---|---|
| H3 答复截断的**具体**根因（是 LLM 真短回 / 前端 bug / SSE 中断？） | 需 EventStream 信号 | 当前 short-circuit 已兜底；想查真根因等用户贴浏览器 Network EventStream 前 30 行 |
| web-react19-typefix（RunDetail / ChatPanel 5 处 pre-existing 错） | C | 独立 |
| tagextract-testfix（批 D 遗留 2 条测试 drift） | C | 独立；~3 行改动 |
| RulesTab / PermissionsDrawer 表单收敛 refactor | C | Lock 时推到下一轮 |
| F-4 / F-5 · /api/mcp 门 + governance 迁 requiredPermission | C | permissions-v2 OUT |
| F-6 / F-7 / F-8 · 自定义角色 / 团队嵌套 / evaluateAcl 缓存 | A/B | V2.x |
| ingest cleanup 脚本的**自动 re-embed** | B | 当前脚本提示用户重跑 ingest，不自动 |
| Overview `_import knowledge_ 按钮` 若持续复现 | C | 代码已 `data-testid` 埋点，靠用户 F12 定位 |
| `ConfidenceBadge` / `formatRelevanceScore` 迁共享设计系统 | C · UX refactor | 独立 |

---

## 五、工作流使用复盘

- **工作流 B** 用了 2 次（permissions-v2 下半场 + rag-relevance-hygiene）。两次都通过"用户本机信号 → 收敛根因 → Lock scope"节奏跑通；Lock 阶段**核对代码 vs 起草 spec** 各发现 5 处 / 5 处 drift（表名、字段名、HTTP 动词等），证明 Lock 阶段"贴着真实代码写契约"的价值
- **工作流 C** 用了 4 次（批 A~D+F，每批一个 ADR）。小改每批 1-2 小时，当天可清完
- 批次化**按根因分桶**比按严重度分桶效率更高 —— 同根因的多个 bug 共享方案，例如批 B 的 "disabled → onClick setErr" 一次解决 3 个表单
- Sandbox 能跑 `tsc --noEmit` 但不能跑 `pnpm test`（vitest 缺 rollup linux binary + 无 npm registry），测试全都交给用户本机复验；qa-service `pnpm test` 到目前累计 **新增 ~30 case 0 新 fail**
