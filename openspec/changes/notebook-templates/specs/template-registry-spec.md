# Spec: NotebookTemplates 注册表

## 模块：services/notebookTemplates.ts

### 公开类型

```ts
import type { ArtifactKind } from './artifactGenerator.ts'

export type NotebookTemplateId =
  | 'research_review'
  | 'meeting_prep'
  | 'competitive_analysis'
  | 'learning_aid'
  | 'project_retrospective'
  | 'translation_explain'

export interface NotebookTemplateSpec {
  id: NotebookTemplateId
  label: string                              // 中文展示名
  icon: string                               // emoji
  desc: string                               // 用户看的简介，≤ 60 字
  recommendedSourceHint: string              // 推荐 sources 引导，≤ 40 字
  recommendedArtifactKinds: ArtifactKind[]   // 0-3 个推荐 artifact（可空，translation_explain 用）
  starterQuestions: string[]                 // 1-3 条推荐起手提问（点击预填）
}
```

### 公开常量 / 函数

```ts
export const NOTEBOOK_TEMPLATES: Record<NotebookTemplateId, NotebookTemplateSpec>
export const ALL_NOTEBOOK_TEMPLATE_IDS: readonly NotebookTemplateId[]
export function isNotebookTemplateId(s: unknown): s is NotebookTemplateId
export function getNotebookTemplate(id: NotebookTemplateId): NotebookTemplateSpec
```

---

## 行为契约

### Scenario: NotebookTemplateId 6 元 union

- Given enum
- Then 包含且仅包含：`'research_review' | 'meeting_prep' | 'competitive_analysis'
  | 'learning_aid' | 'project_retrospective' | 'translation_explain'`
- And `ALL_NOTEBOOK_TEMPLATE_IDS.length === 6`

### Scenario: NOTEBOOK_TEMPLATES 完整性

- For each `id in ALL_NOTEBOOK_TEMPLATE_IDS`:
- Then `NOTEBOOK_TEMPLATES[id]` 存在
- And `spec.id === id`
- And `spec.label.length > 0` 且 `≤ 10` 字
- And `spec.icon.length > 0`
- And `spec.desc.length > 0` 且 `≤ 60` 字
- And `spec.recommendedSourceHint.length > 0` 且 `≤ 40` 字
- And `spec.recommendedArtifactKinds: ArtifactKind[]`（可空数组）
- And `spec.starterQuestions.length >= 1`（至少 1 条起手问题）
- And 每条 starterQuestion `length <= 50` 字

### Scenario: recommendedArtifactKinds 引用合法 ArtifactKind

- For each `id in ALL_NOTEBOOK_TEMPLATE_IDS`:
- And for each `kind in NOTEBOOK_TEMPLATES[id].recommendedArtifactKinds`:
- Then `isArtifactKind(kind)` 返回 true（即在 N-002 ALL_ARTIFACT_KINDS 内）

### Scenario: isNotebookTemplateId 守卫

- 6 合法 id → true
- 其它字符串 / 非字符串 → false

### Scenario: getNotebookTemplate 返回引用

- For each `id in ALL_NOTEBOOK_TEMPLATE_IDS`:
- Then `getNotebookTemplate(id) === NOTEBOOK_TEMPLATES[id]`

---

## 6 个模板字面期望（softer assertion，可调）

| id | label | icon | recommendedArtifactKinds |
|---|---|---|---|
| research_review | 研究综述 | 🔬 | ['briefing', 'faq', 'glossary'] |
| meeting_prep | 会议准备 | 🎤 | ['outline', 'slides', 'briefing'] |
| competitive_analysis | 竞品分析 | 📊 | ['comparison_matrix', 'briefing'] |
| learning_aid | 学习辅助 | 📚 | ['mindmap', 'outline', 'glossary'] |
| project_retrospective | 项目复盘 | ⏱️ | ['timeline', 'briefing', 'faq'] |
| translation_explain | 翻译/解释 | 🌐 | []（无预设 artifact）|

测试只锁 label / icon / recommendedArtifactKinds 这种关键映射；desc / starterQuestions
具体内容由代码内联，迭代不改 schema。
