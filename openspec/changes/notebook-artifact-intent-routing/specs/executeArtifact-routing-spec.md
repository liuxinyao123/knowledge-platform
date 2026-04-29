# Spec: executeArtifact 双路径行为

## 模块：services/artifactGenerator.ts · `executeArtifact`

## 行为契约

### Scenario: spec.intent 存在 + env on → 走档 B 路径

- Given `kind = 'briefing'`，`ARTIFACT_REGISTRY['briefing'].intent === 'language_op'`
- And env `B_ARTIFACT_INTENT_ROUTING_ENABLED` 默认 / `true`
- And notebook 含 ≥ 1 source
- When `executeArtifact(artifactId, 'briefing')` 执行
- Then 内部调 `buildSystemPromptByIntent('language_op', ctx, '', 'footnote')`
- And `chatComplete` 入参 `system` = 该返回值（含通用规则 + footnote + context）
- And `chatComplete` 入参 `messages = [{ role: 'user', content: '请基于上面的文档生成「简报」，按以下格式：\n\n${spec.promptTemplate.replace("{标题}", notebookName)}' }]`
- And `chatComplete` 入参 `maxTokens = spec.maxTokens`（3000）

### Scenario: spec.intent 存在但 env off → 走 N-002 老路径

- Given env `B_ARTIFACT_INTENT_ROUTING_ENABLED=false`
- And `kind = 'briefing'`（spec.intent = 'language_op'）
- When `executeArtifact` 执行
- Then **不**调 `buildSystemPromptByIntent`
- And `chatComplete` 入参 `system = ${spec.promptTemplate.replace("{标题}", notebookName)}\n\n# 文档：\n${ctx}`
- And `messages = [{ role: 'user', content: '请生成简报。' }]`
- And 行为完全等价 N-002

### Scenario: spec.intent 缺省（理论上 N-005 后不会发生）→ 走 N-002 老路径

- Given 假设某 spec.intent === undefined（防御性，N-005 后不该有）
- When `executeArtifact` 执行
- Then 走 N-002 老路径（同上）
- 这是兜底确保任何配置异常都能 fallback

### Scenario: comparison_matrix 走 multi_doc_compare 模板

- Given `kind = 'comparison_matrix'`，`spec.intent === 'multi_doc_compare'`
- When `executeArtifact` 执行（env on）
- Then `system` = `buildSystemPromptByIntent('multi_doc_compare', ctx, '', 'footnote')`
- And `system` 含 multi_doc_compare 模板的"对比/分项模式"+ "强制结构化分项"+ "不漏组件"
- And `user message` 含 spec.promptTemplate 的"对象 1 / 对象 2 / 维度 A / 维度 B" 表格格式描述

### Scenario: glossary 走 factual_lookup 模板

- Given `kind = 'glossary'`，`spec.intent === 'factual_lookup'`
- When `executeArtifact` 执行（env on）
- Then `system` = `buildSystemPromptByIntent('factual_lookup', ctx, '', 'footnote')`
- And `system` 含 factual_lookup 模板的"严格 verbatim"+ "不引入外部知识"
- And `user message` 含 spec.promptTemplate 的"术语：定义"列表格式描述

### Scenario: contextStrategy = 'extended' 仍生效

- Given `kind = 'slides'`，`spec.contextStrategy === 'extended'`
- When `executeArtifact` 执行（env on 或 off 都一样）
- Then `collectAssetContent(assetId, 'extended')` 拿 16 samples / 6000 字符上限
- And context 拼接策略不受 intent routing 影响

### Scenario: kind 非法 → 抛错并标 failed（N-002 行为不变）

- Given `executeArtifact(artifactId, 'unknown' as any)`
- When 执行
- Then `notebook_artifact.status = 'failed'`
- And `error = 'unknown artifact kind: unknown'`

### Scenario: notebook 无 source → 抛错（N-002 行为不变）

- Given notebook 无任何 source
- When `executeArtifact` 执行
- Then `error = 'notebook 无任何 source'`
- And `status = 'failed'`

### Scenario: LLM 返空 → 抛错（N-002 行为不变）

- Given chatComplete 返回 `{ content: '' }`
- When `executeArtifact` 执行
- Then `error = 'LLM 返空'`
- And `status = 'failed'`

---

## 输出 meta 字段（向后兼容 + 加 intent_used）

```jsonc
{
  "sources_snapshot": [{ "asset_id": ..., "asset_name": "..." }],
  "source_count": N,
  "kind": "briefing",
  "intent_used": "language_op"   // N-005 新增；env off 或 spec.intent 缺省时为 null
}
```

### Scenario: 走档 B 时 meta.intent_used = 该 intent

- Given env on + spec.intent = 'language_op'
- Then `meta.intent_used === 'language_op'`

### Scenario: 走 N-002 老路径时 meta.intent_used = null

- Given env off OR spec.intent 缺省
- Then `meta.intent_used === null`
- 这让前端 / 调试可见路径选择

---

## 测试覆盖

- 单元测试 `__tests__/artifactRoutingDispatch.test.ts`（新建）：
  - mock `chatComplete` + `getPgPool`，断言传给 LLM 的 system / user / maxTokens
  - 8 个 kind × 2 env 状态 = 16 条 case
  - 验证 meta.intent_used 字段
