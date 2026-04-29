# Proposal: Notebook Artifact 类型扩展（N-002）

## Problem

`apps/qa-service/src/services/artifactGenerator.ts` 当前仅支持 2 类 artifact
（briefing + faq）。代码硬编码：
- `export type ArtifactKind = 'briefing' | 'faq'` 2 元 union
- 2 个 prompt 常量 + if-else 分支
- 路由校验 `if (kindRaw !== 'briefing' && kindRaw !== 'faq')`
- 前端 KINDS 数组硬编码 2 项

用户场景多样，2 类不够：研发文档要思维导图、会议纪要要大纲、历史文档要时间线、
多方案选型要对比矩阵、行业报告要术语表、汇报准备要演示稿大纲。

## Scope（本 Change）

1. **新增 `ArtifactSpec` 接口 + `ARTIFACT_REGISTRY` 注册表**（`services/artifactGenerator.ts`）
2. **`ArtifactKind` 从 2 元扩展到 8 元 union**：
   - 现有：`briefing` / `faq`
   - 新增：`mindmap` / `outline` / `timeline` / `comparison_matrix` / `glossary` / `slides`
3. **`executeArtifact` 改造**：用 `getArtifactSpec(kind)` 查注册表；删除 if-else 分支
4. **路由校验改用 `isArtifactKind`**（`routes/notebooks.ts:324`）
5. **前端 `StudioPanel.tsx` `KINDS` 同步扩展**（前端 8 项）
6. **预留 `ArtifactSpec.intent?: AnswerIntent` 字段**（N-005 接入意图分流时用，本 change 不消费）
7. **6 个新 prompt 模板**（写在 `ARTIFACT_REGISTRY` 内联）
8. **单元测试**：注册表完整性 / isArtifactKind 守卫 / 每个 spec 字段非空 / promptTemplate 含 [^N] 占位

## Out of Scope（后续 Change）

- artifact 流式生成
- artifact 自动重生成（sources 变更监听）→ N-003
- artifact 接入档 B 意图分流 → N-005
- artifact 模板可视化编辑 / 跨 notebook 共享 → N-006 / N-008

## 决策记录

| ID | 决策 | 替代方案 | 理由 |
|---|---|---|---|
| D-001 | 注册表机制（C-B 方案） | 复制粘贴 if-else / 直接复用档 B 模板 | 扩展性 + 跟 N-005 对接干净 |
| D-002 | 8 类 enum（briefing+faq+6 新）| 更多 / 更少 | 覆盖主流 notebook 场景；超 8 类维护成本陡 |
| D-003 | prompt 写注册表 inline，不抽 .md 模板文件 | 抽到 config/prompts/*.md | 当前规模适合内联；未来 D-004 prompt 数据化时再抽 |
| D-004 | 引用样式 `[^N]`（artifact 在 notebook 内显示，跟 ChatPanel 一致）| `[N]` | ChatPanel + StudioPanel 都用 footnote 解析；不引入额外 markdown 渲染层差异 |
| D-005 | 预留 `intent?` 字段但不消费 | 完全不留 / N-002 就接入档 B | 跟 N-005 干净对接，N-002 落地后 N-005 改动只在注册表内 |
| D-006 | `slides` 类用 `contextStrategy: 'extended'` 拿更多 chunks | 全部默认 | slides 8-15 张需要更多素材 |
| D-007 | 数据库 notebook_artifact.kind 字段无 enum constraint，无需 migration | 加 constraint | 字段已是 varchar，扩 kind 仅前后端代码改动 |

## 接口契约（freeze 项）

详见 `specs/artifact-registry-spec.md`。

下游消费者：
- N-003 监听 sources 变更时按 `ARTIFACT_REGISTRY` 决定哪些 kind 标 stale
- N-005 给每个 spec 填 `intent`，executeArtifact 改走 buildSystemPromptByIntent
- N-006 Notebook templates 引用 `ALL_ARTIFACT_KINDS` 让模板预设 artifact 套件
