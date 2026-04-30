# Spec · buildFactualLookupPrompt 改造

> 模块: `apps/qa-service/src/services/answerPrompts.ts`

## ADDED Requirements

### isFactualStrictVerbatimEnabled

```ts
export function isFactualStrictVerbatimEnabled(): boolean
```

- 读 `process.env.FACTUAL_STRICT_VERBATIM_ENABLED`
- **默认 `false`**（A4 verify 反直觉发现：严格 prompt 反而更易拒答）
- `true / 1 / on / yes`（大小写不敏感）→ `true`，opt-in 实验通道

## MODIFIED Requirements

### buildFactualLookupPrompt

签名不变 `(context: string, inlineImageRule: string) => string`。

**严格行为**（env=true，opt-in 实验）：

第 1 条规则改为两段：
```
1. **先尝试 verbatim 提取**：扫描 [1]..[N] chunks 找出含问题关键实体（数值/术语/
   人名/缩写）或同义实体的片段，完整 verbatim 引用相关片段。**只有所有 chunks 都
   完全没有出现问题的关键实体或同义实体时**才说「知识库中没有相关内容」。不引入
   文档外的事实、背景、推断、评价。
```

第 2-5 条不变：
- 2 禁止模糊措辞
- 3 verbatim 数值/规格/单位
- 4 [N] 引用
- 5 不漏组件

**默认行为**（env 未设 / =false）：完整保留原第 1 条 "只使用提供的文档作答...找不到就说「知识库中没有相关内容」，不要猜"，其它 4 条相同。

A4 verify 反直觉发现：fast LLM 对长复杂指令（严格版）反而更易拒答；简单的 legacy prompt 让 LLM 更愿做"部分回答 + 引用 verbatim 数值"。default off 保留生产现状直到 D-002.7 重新设计 prompt。

## Acceptance Tests

模块 `apps/qa-service/src/__tests__/answerPrompts.test.ts` 必须包含：

| ID | 场景 | 期望 |
|---|---|---|
| FL-1 | env=true (opt-in), prompt 含 "先尝试 verbatim 提取" | toContain |
| FL-2 | env=true, prompt 含 "完全没有出现问题的关键实体或同义实体" | toContain |
| FL-3 | 默认 (env 未设), prompt 是 legacy（含 "找不到就说" 不含 "先尝试 verbatim"）| toContain + not.toContain |
| FL-4 | env true/false 切换, 其它 4 个 intent prompt 完全相同 | stringEquals |
| FL-5 | env=true, footnote 模式：prompt prefix 段 [N] → [^N]（context 段不变）| toContain '[^N]' before '文档内容：' |
| FL-6 | env 守卫 3 case：默认 off / true 等显式启用 / 其它值仍 off | isFactualStrictVerbatimEnabled |
