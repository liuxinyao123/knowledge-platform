# Impl Plan · N-006 Notebook Templates

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Execute（B-3）
> OpenSpec：`openspec/changes/notebook-templates/`
> Explore：`docs/superpowers/specs/notebook-templates/design.md`

## 已完成清单（task 编号对照 tasks.md）

### 后端
| Task | 文件 | 改动 |
|---|---|---|
| BE-1 ~ BE-2 | `apps/qa-service/src/services/notebookTemplates.ts`（新建） | NotebookTemplateId 6 元 union / NotebookTemplateSpec interface / NOTEBOOK_TEMPLATES 6 项内联 / ALL_NOTEBOOK_TEMPLATE_IDS / isNotebookTemplateId / getNotebookTemplate / validateNotebookTemplatesRegistry |
| BE-3 | `apps/qa-service/src/services/pgDb.ts` | ensureSchema 加 `ALTER TABLE notebook ADD COLUMN IF NOT EXISTS template_id VARCHAR(64)` |
| BE-4/5 | `apps/qa-service/src/routes/notebooks.ts` POST `/` | 加 template_id 入参解析 + 校验（非 string → 400 / 非法 enum → 400 + 列出 6 合法值）+ INSERT 含字段 + RETURNING 含字段 |
| BE-6 | 同上 GET `/:id` | SELECT 加 template_id 字段，详情响应含字段 |
| BE-8 | 同上新增 GET `/templates` | 必须放在 GET `/:id` 之前避免路由冲突；返回所有 6 模板 spec + Cache-Control: public, max-age=3600 |
| BE-9 | `apps/qa-service/src/__tests__/notebookTemplates.test.ts`（新建） | 31 用例：6 元 union / 完整性 / 守卫 / 引用 / artifact kinds 合法 / 字面期望 / validateRegistry |
| BE-10 | `npx tsc --noEmit` + tsx smoke `/tmp/smoke_n006.ts` | exit 0 / 31 断言全过 |

### 前端
| Task | 文件 | 改动 |
|---|---|---|
| FE-1/2/3/4 | `apps/web/src/api/notebooks.ts` | 新增 NotebookTemplateId / NotebookTemplateSpec / ALL_NOTEBOOK_TEMPLATE_IDS 类型镜像；listTemplates() API client；createNotebook 加 template_id 入参；NotebookSummary 加 template_id 可选字段 |
| FE-5 | 接入 `apps/web/src/knowledge/Notebooks/index.tsx` CreateNotebookModal | 单 modal 内合并模板选择 + name 输入；展示 6 模板 + "📄 空白" 选项卡片网格；选中高亮（紫框 + 阴影）；submit 时连同 template_id 发请求 |
| FE-7 | `apps/web/src/knowledge/Notebooks/TemplateHintCard.tsx`（新建） | 接 templateId → listTemplates() 找到 spec → 渲染卡片含 label / icon / desc / recommendedSourceHint / 推荐 artifact 按钮（onTriggerArtifact callback）/ starter questions 芯片（onPickStarter callback）/ 关闭按钮（localStorage `notebook_${id}_template_hint_dismissed=1`）|
| FE-8 | `apps/web/src/knowledge/Notebooks/Detail.tsx` | 顶部接 TemplateHintCard（条件 notebook.template_id 存在）；onTriggerArtifact 调 generateArtifact；onPickStarter setChatPrefill state；ChatPanel 加 prefillInput / onPrefillConsumed props |
| FE-补 | `apps/web/src/knowledge/Notebooks/ChatPanel.tsx` | Props 加 prefillInput / onPrefillConsumed；useEffect 监听 prefillInput 变化 → setInput → onPrefillConsumed |
| FE-9 | `npx tsc --noEmit -p apps/web/tsconfig.app.json` | exit 0 |

### 文档
| Task | 文件 |
|---|---|
| DOC-1 | `docs/superpowers/specs/notebook-templates/design.md` ✓ |
| DOC-2 | `openspec/changes/notebook-templates/{proposal,specs/{template-registry,notebook-create-flow}-spec,tasks}.md` ✓ |
| DOC-3 | 本文件 ✓ |

## 待办（B-4 验证 · 用户在 macOS 跑）

| Task | 期望产物 | 谁做 |
|---|---|---|
| V-1 | `pnpm -C apps/qa-service test` notebookTemplates 31 case 全过；现有套件零回归 | user |
| V-2 | `curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/notebooks/templates` 返回 6 模板 + Cache-Control header | user |
| V-3 | `curl -X POST` 创建 notebook，带合法 template_id 创建成功；带非法（如 'foo'）→ 400 + 错误信息列出 6 合法值 | user |
| V-4 | Web UI 点 "+ 新建笔记本" → 弹 modal 含 6 模板 + 空白；选研究综述 → 输入名称 → 创建 → Detail 顶部出现"🔬 研究综述模板"提示卡 | user |
| V-5 | 提示卡推荐 artifact 按钮（briefing/faq/glossary）可点击，触发 generateArtifact，去 Studio 面板看到 pending → done | user |
| V-6 | 提示卡 starterQuestion 芯片点击，预填到 ChatPanel 输入框 | user |
| V-7 | 关闭提示卡后刷新 Detail 页面，localStorage 记忆生效，不再显示 | user |
| V-8 | 老 notebook（template_id NULL）打开后 Detail 不显示提示卡 | user |
| V-9 | 提示卡 dismissed 后清掉 localStorage（手动 `localStorage.removeItem('notebook_42_template_hint_dismissed')`）刷新页面 → 提示卡重现 | user（可选）|

## Archive（B-4 验证通过后）
- [ ] AR-1：`docs/superpowers/specs/notebook-templates/` → `docs/superpowers/archive/notebook-templates/`
- [ ] AR-2：看板 Done
- [ ] AR-3：合并 PR；NotebookTemplateId 6 元 freeze
- [ ] AR-4：通知下游：N-008 公共模板可继承 NotebookTemplateSpec schema 扩展为允许用户提交

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| 6 个模板的内容（label / desc / starter questions）不够精准 | 内容在代码注册表，可随时改注册表 + 重启 service 全用户立即更新（一致体验）|
| 模板 schema 升级（加新字段）破坏老 notebook | 字段全在代码层；DB 只存 template_id，加 spec 字段零迁移 |
| 用户跟模板"绑死" | 提示卡可 dismiss + 模板只是建议（不强制 artifact / 不强制起手问题）+ 用户随时改任何 artifact |
| 老 notebook 无 template_id | 字段 nullable + Detail 内 `notebook.template_id &&` 守卫；老 notebook 不显示提示卡 |
| 路由冲突（`/:id` 吃掉 `/templates`）| 已修：`/templates` 必须放 `/:id` 之前；已注释提醒维护者 |
| 整套 N-006 revert | 撤所有 commit 即可；DB ALTER 是 IF NOT EXISTS 兼容 |

## 与 N-* 系列协同

- **N-002 ARTIFACT_REGISTRY** → 6 模板的 recommendedArtifactKinds 直接引用 ArtifactKind 枚举
- **N-005 intent 映射** → 模板触发的 artifact 自动走档 B 意图分流（无额外配置）
- **N-003 stale 检测** → 用户用模板生成 artifact 后加 source 同样会标 stale，无冲突
- **N-004 condense 改写徽标** → 跟模板正交
- **未来 N-008** 公共模板/用户自定义：复用 NotebookTemplateSpec schema，只加"来源"字段（system/user/community）
