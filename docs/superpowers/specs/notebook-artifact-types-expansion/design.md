# Explore · Notebook Artifact 类型扩展（N-002）

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Explore
> 上游依赖：N-001 notebook-intent-routing-integration（已 B-3 完成，等 V-* 验证 + Archive）
> 后续消费：N-005 artifact 接入意图分流 → 复用本 change 的注册表机制 + ArtifactSpec 接口

## 背景

`apps/qa-service/src/services/artifactGenerator.ts` 当前仅支持 2 类 artifact：

| kind | 实现 |
|---|---|
| `briefing` | 4 段式结构化简报（核心论点 / 共识分歧 / 关键数据 / 行动建议） |
| `faq`      | 8-12 条 Q&A |

代码结构：
- `export type ArtifactKind = 'briefing' \| 'faq'`（硬编码 2 元 union）
- 2 个 prompt 常量 `PROMPT_BRIEFING` / `PROMPT_FAQ`
- `executeArtifact` 用 `kind === 'briefing'` if-else 选 prompt
- `routes/notebooks.ts:324` 同样硬编码 `if (kindRaw !== 'briefing' && kindRaw !== 'faq')` 校验
- 前端 `StudioPanel.tsx` `KINDS` 数组硬编码 2 项

用户场景多样，2 类不够：
- 研发文档 → 想要"思维导图"看层级关系
- 会议纪要 → 想要"大纲"
- 历史文档 / 项目里程碑 → 想要"时间线"
- 多方案选型 → 想要"对比矩阵"
- 学术资料 / 行业报告 → 想要"术语表"
- 准备汇报 → 想要"演示稿大纲"

## 设计候选 (3 选 1)

| 方案 | 描述 | 评估 |
|---|---|---|
| **C-A 复制粘贴**：再加 6 个 PROMPT_* 常量 + 6 个 if-else 分支 | 当前 2 类的暴力扩展 | 维护成本高、第 9 类时无法扩 |
| **C-B 注册表机制**（选中）：`ArtifactSpec` 接口 + `ARTIFACT_REGISTRY: Record<ArtifactKind, ArtifactSpec>`；executeArtifact 查注册表 | 第 N+1 类只需注册一行；前后端共享 enum；跟 N-005 兼容（ArtifactSpec 加可选 `intent` 字段，落地 N-005 时切档 B 模板）| **优点**：扩展性 + 一致性 + 跟 N-005 对接干净 |
| **C-C 用 N-001 citationStyle + 档 B 模板（跳过专用 prompt）**：每个 artifact 直接走档 B 一个 intent + footnote | 复用 N-001 已有架构 | 5 类档 B intent 不够覆盖 8 类 artifact 语义；语义错配（briefing 不是 multi_doc_compare）；硬塞会损失 artifact 的"格式性"约束 |

**结论**：走 C-B。注册表机制 + 每 ArtifactSpec 仍带专用 prompt（暂不接入档 B），但
**预留 `intent?: AnswerIntent` 字段**——N-005 实施时若发现 artifact 跟 intent 有
明确映射可切换。

## 8 类 artifact 设计

| kind | label | icon | desc（用户看的）| prompt 重点 | maxTokens |
|---|---|---|---|---|---|
| `briefing` (现有) | 简报 | 📋 | 结构化总结：核心论点/共识分歧/关键数据/行动建议 | 4 段式 markdown | 3000 |
| `faq` (现有) | FAQ | ❓ | 8-12 条最值得关注的 Q&A | Q&A 配 [^N] | 3000 |
| `mindmap` | 思维导图 | 🧠 | 层级化梳理：中心主题 → 子主题 → 叶节点 | markdown 嵌套列表 + 中心主题加粗；3-4 层 | 2000 |
| `outline` | 大纲 | 📑 | 一二三级标题的纯结构化大纲 | markdown headings only，每节后 1-2 行说明 | 2500 |
| `timeline` | 时间线 | ⏱️ | 按时间顺序排列的事件 | markdown 表格或时间序列列表，每条含 日期/事件/[^N] | 2500 |
| `comparison_matrix` | 对比矩阵 | 📊 | 多对象 × 多维度对比表 | markdown table，对象作行，维度作列 | 2500 |
| `glossary` | 术语表 | 📖 | 文档涉及的术语 + 定义 | "**术语**：定义 [^N]" 列表，按字母/拼音序 | 2500 |
| `slides` | 演示稿大纲 | 🎞️ | 分页幻灯片大纲（含 speaker notes） | "## Slide N: 标题\\n- 要点\\nNotes: ..." 8-15 张 | 3500 |

## ArtifactSpec 接口设计

```ts
import type { AnswerIntent } from './answerIntent.ts'

export type ArtifactKind =
  | 'briefing' | 'faq'                                          // 现有
  | 'mindmap' | 'outline' | 'timeline'                          // N-002 新增
  | 'comparison_matrix' | 'glossary' | 'slides'                  // N-002 新增

export interface ArtifactSpec {
  /** 持久化 + API 用 */
  id: ArtifactKind
  /** 前端展示 */
  label: string
  icon: string
  desc: string
  /** prompt 模板（含 {标题} 占位符）；用户消息固定为 "请生成 X。" */
  promptTemplate: string
  /** LLM 调用参数 */
  maxTokens: number
  temperature?: number    // 默认沿用 chatComplete 默认
  /**
   * N-005 候选字段：将来 artifact 接入档 B 时，指定该 artifact 走哪个意图模板。
   * 本 change 不消费这个字段，只预留接口。
   */
  intent?: AnswerIntent
  /**
   * context 收集策略，可选；默认 collectAssetContent（headings + samples 8）
   * 大型 artifact（如 slides）可能需要更多 context
   */
  contextStrategy?: 'default' | 'extended'
}

export const ARTIFACT_REGISTRY: Record<ArtifactKind, ArtifactSpec> = {
  briefing:          { ... },
  faq:               { ... },
  mindmap:           { ... },
  outline:           { ... },
  timeline:          { ... },
  comparison_matrix: { ... },
  glossary:          { ... },
  slides:            { ... contextStrategy: 'extended', maxTokens: 3500 },
}

export const ALL_ARTIFACT_KINDS: readonly ArtifactKind[] = Object.keys(ARTIFACT_REGISTRY) as ArtifactKind[]

export function isArtifactKind(s: unknown): s is ArtifactKind {
  return typeof s === 'string' && (ALL_ARTIFACT_KINDS as readonly string[]).includes(s)
}

export function getArtifactSpec(kind: ArtifactKind): ArtifactSpec {
  return ARTIFACT_REGISTRY[kind]
}
```

## executeArtifact 改造（最小侵入）

```ts
export async function executeArtifact(
  artifactId: number,
  kind: ArtifactKind,
): Promise<void> {
  // 验证 kind（防御）
  if (!isArtifactKind(kind)) throw new Error(`unknown artifact kind: ${kind}`)
  const spec = getArtifactSpec(kind)
  
  // ... 现有 1-2 步：拉 notebook + sources 不变
  
  // 3) 拼 prompt（按 spec.promptTemplate）
  const promptHead = spec.promptTemplate.replace('{标题}', notebookName)
  const ctx = sources
    .map((s, i) => `[${i + 1}] ${s.asset_name}\n${s.text}`)
    .join('\n\n---\n\n')
  
  const result = await chatComplete(
    [{ role: 'user', content: `请生成${spec.label}。` }],
    {
      system: `${promptHead}\n\n# 文档：\n${ctx}`,
      maxTokens: spec.maxTokens,
      temperature: spec.temperature,
    },
  )
  
  // ... 4) 写完成不变
}
```

## 路由层校验改用 isArtifactKind

```ts
// routes/notebooks.ts:324 改
- if (kindRaw !== 'briefing' && kindRaw !== 'faq') {
-   return res.status(400).json({ error: 'kind must be briefing or faq' })
- }
+ if (!isArtifactKind(kindRaw)) {
+   return res.status(400).json({ error: `kind must be one of: ${ALL_ARTIFACT_KINDS.join('/')}` })
+ }
```

## 前端 StudioPanel KINDS 同步

```ts
// apps/web/src/knowledge/Notebooks/StudioPanel.tsx
// KINDS 数组从 2 项扩到 8 项，每项 { id, label, icon, desc }
// 前端不消费 promptTemplate / maxTokens（那是后端关心）
```

## 引用样式：用 [^N]

所有新 artifact prompt 模板都用 `[^N]` 引用样式（跟 notebookChat 一致，因为
artifact 也展示在 notebook 内的 StudioPanel，前端用同套 markdown 渲染）。

**不**复用 N-001 的 `citationStyle: 'footnote'` —— artifact 不走 ragPipeline，
直接调 chatComplete。每个 prompt 模板里的 `[^N]` 是字面写死的。

## 风险

| 风险 | 缓解 |
|---|---|
| **8 类 artifact prompt 偏置** | 跟 rag-intent-routing 同样的"任意文档兼容"约束：prompt 不绑定具体文档形态（无道德经/mm/COF 类示例）；用抽象描述 + 格式约束 |
| **大文档 context 撑爆**（slides 等需要更多 context）| ArtifactSpec.contextStrategy = 'extended'，collectAssetContent 加分支拿更多 chunks |
| **某 artifact 类型对小 source 表现差**（如 timeline 但文档没时间数据）| prompt 加诚实约束："文档里没有时间数据时，输出'文档未提供时间序列信息'"；类似 ADR-46 D-001 抽象规则 |
| **前后端 enum 不一致** | TypeScript 共享类型；前端 import 后端的 ArtifactKind（已有 `apps/web/src/api/notebooks.ts` 镜像） |
| **数据库 notebook_artifact.kind 字段是 varchar**，新 enum 值兼容 | 字段无 enum constraint，扩 kind 仅前后端代码改动；migrations 不需要 |
| **现有数据库里只有 briefing/faq 数据** | 不动；用户开始用新 kind 后自然产生新行 |

## 与 N-005 的对接

- N-002 引入 `ArtifactSpec.intent?: AnswerIntent` 字段但不消费
- N-005 实施时为每个 ArtifactSpec 填合适的 intent：
  - `briefing` / `outline` → `language_op`（对原文做总结/提炼）
  - `comparison_matrix` → `multi_doc_compare`
  - `glossary` → `factual_lookup`（提取术语 + 原文定义）
  - `mindmap` / `timeline` / `slides` / `faq` → 留 `language_op`（都是基于原文做转换）
- N-005 时 executeArtifact 改：如 spec.intent 存在，调 buildSystemPromptByIntent 而非 spec.promptTemplate

## Out of Scope（明确不做）

- artifact 流式生成（当前非流式，3 秒内拿到结果是可接受的）
- artifact 模板可视化编辑（用户改 prompt）→ N-006 templates 候选
- artifact 跨 notebook 共享（"把简报模板分享给团队"）→ N-008
- artifact 历史版本对比 → 后续
- artifact 自动重生成（sources 变了 → trigger）→ N-003 单独做

## 后续路径

1. **N-002 落地** = artifact 类型扩展 + 注册表机制
2. **N-003** artifact 自动重生成（sources 变更监听）
3. **N-005** artifact 接入意图分流（用 ArtifactSpec.intent 切档 B 模板）
4. **N-006** Notebook templates（含预设 artifact 套件）
