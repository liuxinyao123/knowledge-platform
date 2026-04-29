# Spec: ArtifactSpec 接口 + ARTIFACT_REGISTRY 注册表

## 模块：services/artifactGenerator.ts

### 公开类型

```ts
import type { AnswerIntent } from './answerIntent.ts'

export type ArtifactKind =
  | 'briefing' | 'faq'                                          // 现有 V1
  | 'mindmap' | 'outline' | 'timeline'                          // N-002 新增
  | 'comparison_matrix' | 'glossary' | 'slides'                 // N-002 新增

export interface ArtifactSpec {
  id: ArtifactKind
  label: string                       // 中文展示名（前后端共用）
  icon: string                        // emoji
  desc: string                        // 用户看的简介（前端 UI 展示）
  promptTemplate: string              // system prompt 模板（含 {标题} 可选占位）
  maxTokens: number                   // chatComplete maxTokens
  temperature?: number                // chatComplete temperature；缺省用 LLM 默认
  intent?: AnswerIntent               // N-005 候选字段，本 change 不消费
  contextStrategy?: 'default' | 'extended'  // 默认 default；extended 拿更多 chunks
}
```

### 公开常量 / 函数

```ts
export const ARTIFACT_REGISTRY: Record<ArtifactKind, ArtifactSpec>
export const ALL_ARTIFACT_KINDS: readonly ArtifactKind[]
export function isArtifactKind(s: unknown): s is ArtifactKind
export function getArtifactSpec(kind: ArtifactKind): ArtifactSpec
```

---

## 行为契约

### Scenario: ArtifactKind 8 元 union

- Given enum
- Then 包含且仅包含：`'briefing' | 'faq' | 'mindmap' | 'outline' | 'timeline'
  | 'comparison_matrix' | 'glossary' | 'slides'`
- And `ALL_ARTIFACT_KINDS.length === 8`

### Scenario: ARTIFACT_REGISTRY 完整性

- For each `kind in ALL_ARTIFACT_KINDS`:
- Then `ARTIFACT_REGISTRY[kind]` 存在
- And `ARTIFACT_REGISTRY[kind].id === kind`
- And `ARTIFACT_REGISTRY[kind].label.length > 0`
- And `ARTIFACT_REGISTRY[kind].icon.length > 0`
- And `ARTIFACT_REGISTRY[kind].desc.length > 0`
- And `ARTIFACT_REGISTRY[kind].promptTemplate.length > 100`（不能是占位空 prompt）
- And `ARTIFACT_REGISTRY[kind].maxTokens >= 1500 && maxTokens <= 4000`

### Scenario: isArtifactKind 守卫

- Given 字符串
- When 调用 `isArtifactKind(s)`
- Then 8 个合法 kind 都返回 `true`
- And 任何其它字符串 / 非字符串都返回 `false`

### Scenario: getArtifactSpec 返回引用

- Given 任一合法 kind
- When `getArtifactSpec(kind)`
- Then 返回 `ARTIFACT_REGISTRY[kind]`（同一个对象引用）

### Scenario: promptTemplate 字面约束

- For each `spec in ARTIFACT_REGISTRY`:
- Then `spec.promptTemplate` 包含 `[^N]` 字面（footnote 引用样式约束 LLM）
- And **不**包含禁词：道德经 / 老子 / 缓冲块 / COF / B&R / Swing / 油漆变差 / 铰链公差
  （跟 rag-intent-routing 同样的"任意文档兼容"约束）

### Scenario: intent 字段是可选（N-002 不消费）

- For each `spec in ARTIFACT_REGISTRY`:
- Then `spec.intent` 可为 `undefined`（本 change 默认全 undefined）
- And N-005 实施时填充对应 intent

### Scenario: slides 用 extended context strategy

- Given `ARTIFACT_REGISTRY['slides']`
- Then `spec.contextStrategy === 'extended'`
- And `spec.maxTokens >= 3000`

---

## 路由层校验

### Scenario: routes/notebooks.ts 改用 isArtifactKind

- Given `POST /api/notebooks/:id/artifacts/:kind` 请求
- When `kind = 'invalid_kind'`
- Then 响应 400 `{ error: 'kind must be one of: briefing/faq/mindmap/outline/timeline/comparison_matrix/glossary/slides' }`

### Scenario: 8 类合法 kind 都能成功创建 artifact

- For each `kind in ALL_ARTIFACT_KINDS`:
- Given notebook 含 ≥ 1 source
- When POST `/api/notebooks/:id/artifacts/${kind}`
- Then 返回 202 `{ artifactId: number }`
- And 后台 fire-and-forget `executeArtifact(artifactId, kind)`

---

## executeArtifact 改造

### Scenario: 用 getArtifactSpec 替代 if-else

- Given 任一合法 kind
- When `executeArtifact(artifactId, kind)` 执行
- Then 内部调 `getArtifactSpec(kind)` 拿 spec
- And 用 `spec.promptTemplate` 拼 system prompt
- And 用 `spec.maxTokens` / `spec.temperature` 调 chatComplete
- And 用户消息固定为 `'请生成${spec.label}。'`

### Scenario: kind 非法 → 抛错

- Given `executeArtifact(artifactId, 'unknown')`
- When 执行
- Then 抛 `Error('unknown artifact kind: unknown')`
- And catch 后写 `notebook_artifact.status = 'failed'`

### Scenario: contextStrategy = 'extended' 拿更多 chunks

- Given `spec.contextStrategy === 'extended'`
- When `collectAssetContent` 执行
- Then 拿 sample chunks 数量从默认 8 → 16
- And 单 asset 字符上限从 4000 → 6000

---

## 前端契约（apps/web）

### Scenario: api/notebooks.ts 镜像 ArtifactKind

- Given 前端 `apps/web/src/api/notebooks.ts`
- Then `ArtifactKind` 类型定义跟后端一致（手动同步，不通过 codegen）

### Scenario: StudioPanel.tsx KINDS 数组扩到 8 项

- Given `apps/web/src/knowledge/Notebooks/StudioPanel.tsx`
- Then `KINDS` 数组含 8 项 `{ id, label, icon, desc }`
- And 每项的 `id / label / icon / desc` 跟后端 `ARTIFACT_REGISTRY[id]` 一致
  （手动同步；前端不消费 promptTemplate / maxTokens）
