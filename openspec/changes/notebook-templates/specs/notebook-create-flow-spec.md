# Spec: notebook 创建/详情/模板列表 接口

## DB Schema

### Scenario: notebook 表加 template_id 字段

- pgDb.ts ensureSchema 内对现有 notebook 表执行：
  ```sql
  ALTER TABLE notebook ADD COLUMN IF NOT EXISTS template_id VARCHAR(64);
  ```
- 字段 nullable
- 老 notebook 行 template_id 默认 NULL

---

## POST /api/notebooks

### Scenario: 不传 template_id → 创建空白 notebook（向后兼容）

- Given body `{ "name": "新笔记", "description": "..." }`
- When POST /api/notebooks
- Then 201 + `{ id, name, description, owner_email, created_at_ms, template_id: null }`
- And DB notebook.template_id IS NULL

### Scenario: 传合法 template_id → 创建带模板 notebook

- Given body `{ "name": "竞品对比", "template_id": "competitive_analysis" }`
- When POST /api/notebooks
- Then 201 + 返回含 `template_id: "competitive_analysis"`
- And DB notebook.template_id = 'competitive_analysis'

### Scenario: 传非法 template_id → 400

- Given body `{ "name": "x", "template_id": "unknown" }`
- When POST /api/notebooks
- Then 400 `{ error: "invalid template_id; must be one of: research_review/meeting_prep/competitive_analysis/learning_aid/project_retrospective/translation_explain" }`

### Scenario: template_id 类型非 string → 400

- Given body `{ "name": "x", "template_id": 123 }`
- When POST /api/notebooks
- Then 400 `{ error: "template_id must be string" }`

---

## GET /api/notebooks/:id

### Scenario: 详情返回 template_id 字段

- Given notebook id=42, template_id='research_review'
- When GET /api/notebooks/42
- Then 200 响应包含 `template_id: "research_review"`

### Scenario: 老 notebook（template_id = NULL）

- Given notebook id=1, template_id IS NULL
- When GET /api/notebooks/1
- Then 200 响应包含 `template_id: null`（不省略字段，便于前端类型对齐）

---

## GET /api/notebooks/templates （新增接口）

### Scenario: 列出 6 个模板

- When GET /api/notebooks/templates（需 requireAuth；无 ACL 检查 —— 模板是公开元信息）
- Then 200 `{ templates: NotebookTemplateSpec[] }`
- And `templates.length === 6`
- And 顺序：research_review / meeting_prep / competitive_analysis / learning_aid /
  project_retrospective / translation_explain
- And 每条含 id / label / icon / desc / recommendedSourceHint /
  recommendedArtifactKinds / starterQuestions 全字段

### Scenario: 接口缓存友好

- 模板内容 immutable（重启 service 才变）
- 响应 `Cache-Control: public, max-age=3600`（前端 + CDN 都能缓存）

---

## 前端 API client（apps/web/src/api/notebooks.ts）

### Scenario: 类型镜像

- Then 文件含 `export type NotebookTemplateId = '...' | ... | '...'` 跟后端一致
- And 含 `export interface NotebookTemplateSpec` 跟后端一致
- And 含 `export const ALL_NOTEBOOK_TEMPLATE_IDS: readonly NotebookTemplateId[]`

### Scenario: listTemplates() API client

- 调用 `GET /api/notebooks/templates`
- 返回 `Promise<NotebookTemplateSpec[]>`

### Scenario: createNotebook 加可选 template_id

- 现有 `createNotebook(name, description?)` 改 `createNotebook(name, description?, template_id?)`
- 向后兼容：不传 template_id 等价老行为

---

## 前端 UI（apps/web/src/knowledge/Notebooks/）

### Scenario: NotebookTemplatePicker.tsx 新建组件

- Modal 形式弹出
- 列出 6 个模板 + 1 个 "📄 空白 Notebook" 选项
- 用户点选 → onPick(templateId | null)
- 关闭键盘 ESC + 点遮罩外关闭

### Scenario: 创建入口接入

- index.tsx "+ 新建 Notebook" 按钮 → 改为：先弹 `NotebookTemplatePicker`，
  用户选完模板再弹现有的"输入 name + description"对话框
- 或合并为单 modal："选模板 → 输入 name → 创建"

### Scenario: Detail.tsx 顶部模板提示卡

- 如果 notebook.template_id 存在 AND localStorage 没 dismiss 标记：
- 渲染提示卡含 label / icon / desc / recommendedSourceHint /
  recommendedArtifactKinds（可点击触发 generateArtifact）/ starterQuestions
  （可点击预填到 ChatPanel input）/ 关闭按钮
- 用户点关闭 → localStorage `notebook_${id}_template_hint_dismissed = '1'`，永久不再显示
- 老 notebook（template_id NULL）→ 不渲染提示卡

---

## 测试覆盖

- 单元测试 `__tests__/notebookTemplates.test.ts`：注册表完整性 / 守卫 / 引用 /
  recommendedArtifactKinds 都是合法 ArtifactKind / 6 个模板字面期望
- 路由测试可选（依赖 Express + supertest，跟现有 notebooks 测试同套路）
- 前端测试由用户视觉走查（无 vitest UI 测试套件）
