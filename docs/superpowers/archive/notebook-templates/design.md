# Explore · Notebook Templates（N-006）

> 工作流：B `superpowers-openspec-execution-workflow`
> 上游依赖：N-002 ARTIFACT_REGISTRY（已 B-3）+ N-005 intent 映射（已 B-3）

## Background

新建 Notebook 是"完全空白" → 用户不知道这个产品能干什么、要先上传什么、起手该问什么。
老用户重复创建相似 notebook（"3 份竞品 + 询问差异 + 生成对比矩阵 + briefing"）也是
重复劳动。

**模板系统 = 一份预设的"场景 → 推荐 sources 类型 + 推荐 artifact 套件 + 推荐起手问题"**。

## Design Candidates (3 选 1)

| 方案 | 描述 | 评估 |
|---|---|---|
| **C-A 模板 = 完整 notebook 拷贝**：用户选模板就预填入 sources（公共素材）+ 立即触发预设 artifact | 重，需要"公共素材库"；artifact 立刻消耗 LLM token；不灵活 |
| **C-B 模板 = "建议" 而非"行动"**（选中）：模板只承载 schema（推荐 artifact kinds + 起手问题 + 引导文案），用户自己加 sources + 自己点生成；UI 高亮提示 | **优**：轻量 / 不消耗 token / 用户保留控制权 / 可选退出 |
| **C-C 模板 = AI 自动构建**：用户描述需求 LLM 自动选 artifact 套件 | 模糊；超出本 change scope，未来 N-008 候选 |

**结论**：走 C-B。模板=配置，不是自动化。

## 6 个内置模板设计

| template_id | label | icon | recommended_artifact_kinds | starter_questions（点击预填到 ChatPanel input）|
|---|---|---|---|---|
| `research_review` | 研究综述 | 🔬 | briefing / faq / glossary | "这些资料的核心论点是什么"、"列出关键术语和定义" |
| `meeting_prep` | 会议准备 | 🎤 | outline / slides / briefing | "这次会议要讨论的关键点"、"准备一个 5 分钟陈述大纲" |
| `competitive_analysis` | 竞品分析 | 📊 | comparison_matrix / briefing | "这些方案的差异和取舍"、"对比关键指标" |
| `learning_aid` | 学习辅助 | 📚 | mindmap / outline / glossary | "梳理这门课的核心知识结构"、"列出重点术语" |
| `project_retrospective` | 项目复盘 | ⏱️ | timeline / briefing / faq | "项目的关键节点和决策"、"复盘成功因素和坑" |
| `translation_explain` | 翻译/解释 | 🌐 | （无预设 artifact）| "把第一章翻译成中文"、"用白话解释一下这段" |

每个模板还带：
- `desc`: 用户看的简介（< 60 字，告诉用户这个模板适合什么场景）
- `recommended_source_hint`: 推荐 sources 的简短引导（"上传 ≥ 2 份竞品资料"）

## Schema 改动

### 数据库（pgDb.ts ensureSchema）

```sql
-- 在现有 notebook 表后追加
ALTER TABLE notebook ADD COLUMN IF NOT EXISTS template_id VARCHAR(64);
-- 不存 starter_questions / recommended_kinds 之类——这些都从 NOTEBOOK_TEMPLATES 注册表
-- 实时查（前端拿 template_id 后查 templates API 或客户端镜像表）
```

**为什么不存 template_meta JSON**：
- 模板内容（推荐问题 / artifact kinds / 引导文案）属于产品配置，应该集中维护
- 用户后续升级：改了模板内容 → 老 notebook 看到的也是新内容（一致体验）
- 存 JSON 反而会"凝固"老模板版本

### 类型契约

```ts
// services/notebookTemplates.ts

export type NotebookTemplateId =
  | 'research_review' | 'meeting_prep' | 'competitive_analysis'
  | 'learning_aid' | 'project_retrospective' | 'translation_explain'

export interface NotebookTemplateSpec {
  id: NotebookTemplateId
  label: string
  icon: string
  desc: string
  recommendedSourceHint: string
  recommendedArtifactKinds: ArtifactKind[]   // 复用 N-002
  starterQuestions: string[]
}

export const NOTEBOOK_TEMPLATES: Record<NotebookTemplateId, NotebookTemplateSpec>
export const ALL_NOTEBOOK_TEMPLATE_IDS: readonly NotebookTemplateId[]
export function isNotebookTemplateId(s: unknown): s is NotebookTemplateId
export function getNotebookTemplate(id: NotebookTemplateId): NotebookTemplateSpec
```

## API 改动

### `POST /api/notebooks` 加可选 `template_id`

```http
POST /api/notebooks
{ "name": "竞品对比", "description": "...", "template_id": "competitive_analysis" }
```

- `template_id` 缺省 → 走老逻辑（空白 notebook）
- `template_id` 非法 → 400 错误
- `template_id` 合法 → 写 notebook.template_id

### `GET /api/notebooks/:id` 返回 `template_id`

详情接口现有返回里追加 `template_id` 字段；前端 Detail.tsx 拿到后查
NOTEBOOK_TEMPLATES（前端镜像表）展示推荐提示卡。

### 新 `GET /api/notebooks/templates` 列出所有模板

供前端创建时模板选择器调用：

```http
GET /api/notebooks/templates
→ 200 { templates: [{id, label, icon, desc, recommendedSourceHint, recommendedArtifactKinds, starterQuestions}] }
```

## 前端 UI 流程

### 创建 Notebook 时弹模板选择器

`NotebookTemplatePicker.tsx`：列出 6 个模板 + "📄 空白 Notebook" 兜底；
点击其中之一 → 携带 `template_id` 调 POST `/api/notebooks`。

### Detail.tsx 顶部"模板提示卡"

如果 `notebook.template_id` 存在：
```
┌─────────────────────────────────────────┐
│ 🔬 研究综述模板                         │
│ 适合：分析多份学术论文 / 行业报告       │
│ 建议：上传 ≥ 2 篇 paper                │
│ 推荐生成：briefing / faq / glossary    │ ← 点击直接触发对应 artifact
│ 推荐起手提问：                          │
│   • 这些资料的核心论点是什么 ↗         │ ← 点击预填到 ChatPanel input
│   • 列出关键术语和定义 ↗               │
│ [关闭]                                  │ ← localStorage 记忆 dismiss
└─────────────────────────────────────────┘
```

提示卡可关闭（`localStorage[`notebook_${id}_template_hint_dismissed`]`），不烦人。

## Out of Scope

- 模板可视化编辑（用户自定义模板）→ 后续
- 模板分享 / 公共模板市场 → N-008
- 创建时模板自动加 sources（"研究综述模板自动加 1 个示例 paper"）→ 重，本 change 不做
- StudioPanel 高亮"推荐 artifact kinds"按钮（如黄色边框）→ 提示卡里点击足够，不需要再 StudioPanel 里冗余高亮

## 风险

| 风险 | 缓解 |
|---|---|
| 6 个模板的 prompt / 起手问题不够好 | 第一版按本 doc 的设计实施；后续 D-003 多文档 eval 集落地后用真实数据迭代 |
| 模板 schema 升级（加新字段）破坏老 notebook | 字段都在 NOTEBOOK_TEMPLATES 注册表（代码层）；DB 只存 template_id，加字段零迁移 |
| 用户跟模板"绑死" | 提示卡可 dismiss / 模板只是建议不是约束 / 用户随时改任何 artifact |
| 老 notebook 没 template_id | 字段 nullable；老 notebook template_id=null → 不显示提示卡，等同空白模板 |

## 与 N-* 系列协同

- **N-002 ARTIFACT_REGISTRY** → 模板的 `recommendedArtifactKinds` 直接引用 `ArtifactKind` 枚举
- **N-005 intent 映射** → 模板触发的 artifact 自动走档 B 意图分流
- **N-003 stale**：用户用模板生成 artifact 后加 source → 同样会标 stale，无冲突
- **N-004 改写徽标**：跟模板正交
- **未来 N-008 公共模板**：复用 NOTEBOOK_TEMPLATES schema，扩展为允许用户提交自己的模板

## 后续路径

1. **N-006 落地** = 6 内置模板 + 创建选择器 + 详情提示卡
2. **N-008** 用户自定义模板 + 公共市场（依赖本 change schema）
3. **D-005 候选** 用 LLM judge 评价模板的"建议质量"
