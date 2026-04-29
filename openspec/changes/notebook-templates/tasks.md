# Tasks: N-006 Notebook Templates

> 工作流：B `superpowers-openspec-execution-workflow`
> 状态：B-2 完成；进 B-3 Execute

## 后端（apps/qa-service）

### 注册表
- [ ] BE-1：新建 `services/notebookTemplates.ts` —— `NotebookTemplateId` 6 元 union /
      `NotebookTemplateSpec` interface / `NOTEBOOK_TEMPLATES` Record / `ALL_NOTEBOOK_TEMPLATE_IDS` /
      `isNotebookTemplateId` / `getNotebookTemplate`
- [ ] BE-2：6 个模板字面内容（按 design.md 表格 + spec 字面期望）

### DB
- [ ] BE-3：`services/pgDb.ts` ensureSchema 末尾加：
      `ALTER TABLE notebook ADD COLUMN IF NOT EXISTS template_id VARCHAR(64)`

### Routes
- [ ] BE-4：`routes/notebooks.ts` POST `/` 加 template_id 入参解析 + 校验（非法返 400）
- [ ] BE-5：POST `/` SQL 写 template_id；返回响应含 template_id 字段
- [ ] BE-6：GET `/:id` SELECT 加 template_id；返回响应含字段
- [ ] BE-7：GET `/` 列表也返回 template_id（可选，前端列表展示模板 chip 用；本 change 可 skip）
- [ ] BE-8：新增 GET `/templates` 返回所有 6 个模板 spec + Cache-Control: public, max-age=3600

### 测试
- [ ] BE-9：新建 `__tests__/notebookTemplates.test.ts`
      - NotebookTemplateId 6 元
      - NOTEBOOK_TEMPLATES 完整性（每 spec 字段非空 + 长度限制）
      - isNotebookTemplateId 守卫
      - getNotebookTemplate 返回引用
      - recommendedArtifactKinds 全是合法 ArtifactKind
      - 6 个模板的字面期望（label/icon/recommendedArtifactKinds 映射表）
- [ ] BE-10：tsc clean + tsx smoke

## 前端（apps/web）

### 类型 + API client
- [ ] FE-1：`api/notebooks.ts` 加 `NotebookTemplateId` / `NotebookTemplateSpec` 类型 +
      `ALL_NOTEBOOK_TEMPLATE_IDS` 常量（前后端手动同步）
- [ ] FE-2：`api/notebooks.ts` 加 `listTemplates(): Promise<NotebookTemplateSpec[]>`
- [ ] FE-3：`api/notebooks.ts` 改 `createNotebook(name, description?, template_id?)` 三参签名
- [ ] FE-4：`NotebookSummary` / `NotebookDetail` 类型加可选 `template_id?: NotebookTemplateId | null`

### 组件
- [ ] FE-5：新建 `Notebooks/NotebookTemplatePicker.tsx` —— Modal 形式 listTemplates() →
      渲染 6 模板卡片 + "📄 空白" 选项 → onPick(templateId | null)
- [ ] FE-6：改 `Notebooks/index.tsx` 新建按钮 → 先弹 picker，picked 后接现有 name/desc modal
- [ ] FE-7：新建 `Notebooks/TemplateHintCard.tsx` —— 接 templateId → 渲染推荐提示卡
      （label/icon/desc/recommendedSourceHint + 推荐 artifact 按钮 + starter questions
      点击预填 callback + 关闭按钮）
- [ ] FE-8：改 `Notebooks/Detail.tsx` 顶部接入 TemplateHintCard（条件：notebook.template_id
      存在 + localStorage 未 dismiss）；点 starterQuestion 通过 ChatPanel 暴露的
      `presetInput(text)` 方法预填到 input

### 测试
- [ ] FE-9：tsc clean
- [ ] FE-10：（可选）NotebookTemplatePicker.test.tsx 验证 6 卡片渲染

## 文档
- [x] DOC-1：`docs/superpowers/specs/notebook-templates/design.md` ✓
- [x] DOC-2：`openspec/changes/notebook-templates/{proposal,specs/*-spec,tasks}.md` ✓
- [ ] DOC-3：`docs/superpowers/plans/notebook-templates-impl-plan.md`

## 验证（B-4 前置）
- [ ] V-1：`pnpm -C apps/qa-service test` 通过 notebookTemplates 套件
- [ ] V-2：`curl GET /api/notebooks/templates` 返回 6 模板 + Cache-Control
- [ ] V-3：`curl POST /api/notebooks` 带合法 template_id 创建成功；带非法 → 400
- [ ] V-4：Web UI 点新建 → 模板选择器弹出 → 选研究综述 → 创建后 Detail 显示提示卡
- [ ] V-5：提示卡推荐 artifact 按钮可点击触发 generateArtifact
- [ ] V-6：提示卡 starterQuestion 点击预填到 ChatPanel input
- [ ] V-7：关闭提示卡后刷新页面，localStorage 记忆生效，不再显示
- [ ] V-8：老 notebook（template_id NULL）不显示提示卡

## Archive（B-4 验证通过后）
- [ ] AR-1：specs/notebook-templates → archive/
- [ ] AR-2：看板 Done
- [ ] AR-3：合并 PR；NotebookTemplateId 6 元 freeze
- [ ] AR-4：通知下游：N-008 公共模板可继承 NotebookTemplateSpec schema
