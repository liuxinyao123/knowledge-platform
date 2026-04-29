# Spec: ARTIFACT_REGISTRY intent 映射

## 模块：services/artifactGenerator.ts

### `ArtifactSpec.intent` 字段从 N-002 预留升级为消费（值非 undefined）

```ts
// N-005 后的 ARTIFACT_REGISTRY 各 spec.intent 期望值：
ARTIFACT_REGISTRY['briefing'].intent          === 'language_op'
ARTIFACT_REGISTRY['faq'].intent               === 'language_op'
ARTIFACT_REGISTRY['mindmap'].intent           === 'language_op'
ARTIFACT_REGISTRY['outline'].intent           === 'language_op'
ARTIFACT_REGISTRY['timeline'].intent          === 'language_op'
ARTIFACT_REGISTRY['comparison_matrix'].intent === 'multi_doc_compare'
ARTIFACT_REGISTRY['glossary'].intent          === 'factual_lookup'
ARTIFACT_REGISTRY['slides'].intent            === 'language_op'
```

---

## 行为契约

### Scenario: 8 个 spec 的 intent 字段都已填值

- For each `kind in ALL_ARTIFACT_KINDS`:
- Then `ARTIFACT_REGISTRY[kind].intent !== undefined`
- And `isAnswerIntent(ARTIFACT_REGISTRY[kind].intent)` 返回 true

### Scenario: intent 映射符合 D-002 决策

- Given `language_op` artifacts: briefing / faq / mindmap / outline / timeline / slides
- Then 这 6 个 kind 的 spec.intent 都等于 `'language_op'`

- Given `multi_doc_compare` artifacts: comparison_matrix
- Then `ARTIFACT_REGISTRY['comparison_matrix'].intent === 'multi_doc_compare'`

- Given `factual_lookup` artifacts: glossary
- Then `ARTIFACT_REGISTRY['glossary'].intent === 'factual_lookup'`

### Scenario: kb_meta / out_of_scope 不映射任何 artifact

- 这两类 intent 在档 B 中是"目录元查询" / "文档外问题"，不对应任何 artifact
  生成场景；ARTIFACT_REGISTRY 中无 spec.intent 取这两值
- For each `kind in ALL_ARTIFACT_KINDS`:
- Then `ARTIFACT_REGISTRY[kind].intent !== 'kb_meta'`
- And `ARTIFACT_REGISTRY[kind].intent !== 'out_of_scope'`

---

## env 开关 · `B_ARTIFACT_INTENT_ROUTING_ENABLED`

```ts
export function isArtifactIntentRoutingEnabled(): boolean {
  const v = (process.env.B_ARTIFACT_INTENT_ROUTING_ENABLED ?? 'true').toLowerCase().trim()
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no')
}
```

### Scenario: 默认 on

- Given env `B_ARTIFACT_INTENT_ROUTING_ENABLED` 未设
- When 调用 `isArtifactIntentRoutingEnabled()`
- Then 返回 `true`

### Scenario: false / 0 / off / no 关闭

- For each value in ['false', '0', 'off', 'no', 'FALSE', 'Off']:
- Given env 设为该值
- Then `isArtifactIntentRoutingEnabled()` 返回 `false`

---

## 与 N-002 兼容

### Scenario: ArtifactSpec interface 签名不变

- N-002 已定义 `intent?: AnswerIntent` 可选字段
- N-005 仅填值，**不**改字段类型 / 必选性
- 类型层零破坏

### Scenario: ALL_ARTIFACT_KINDS / isArtifactKind / getArtifactSpec 行为不变

- 这 3 个公开函数 N-005 不动
- 行为完全等价 N-002
