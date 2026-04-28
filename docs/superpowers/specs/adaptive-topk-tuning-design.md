# Explore + Spec · adaptiveTopK 中文短查询调优（C 工作流第 1 步）

> 工作流：C `superpowers-feature-workflow`（无需 OpenSpec；不引入跨人接口契约）
> 倒推说明：本文档由 2026-04-28 实地调优后回补。
> 性质：parameter tuning；不新增模块、不改对外接口；调用方零适配。

## 背景 + 问题

`apps/qa-service/src/services/ragPipeline.ts` 的 `adaptiveTopK(question)` 之前
逻辑：

```ts
if (q.length <= 6 || /^[A-Z][A-Z0-9\-_]{1,5}\??$/.test(q)) {
  return 5  // 短查询/英文缩写题统一 K=5
}
```

把"≤6 字符的中文短问题"和"英文大写缩写题"用一个 OR 条件统一走 K=5。问题：

- 中文 6 字符（"什么是道？"5 字 / "缓冲块"3 字 / "道德经第一章"6 字）已经包含
  3-4 个语义单元，K=5 召回扑空概率高
- 英文 3-4 字符的纯大写缩写（"API" / "COF" / "B2B"）本来就语义模糊，K=5 反而更准

中英文短题的"语义密度"差距大，不该共用一个 K。

## 决策

**把英文缩写检测分离到前面，中文短查询提到 K=8。**

```ts
// 1. 英文大写缩写题（≤6 字符，且形如 "API" / "COF" / "B2B"）：噪声大，K=5
if (/^[A-Z][A-Z0-9\-_]{1,5}\??$/.test(q)) return 5
// 2. 中文短查询（≤6 字符）：K=8（之前 5 太窄）
if (q.length <= 6) return 8
// 3. 复合查询 → K=15（不变）
// 4. 默认 → K=10（不变）
```

emit reason 文案从 2 元（短/复合）改为 4 元（英文缩写/中文短/复合/其它），便于
实测时直接看到 K 路由决策。

## 为什么不需要 OpenSpec

- 不引入新接口契约（仍是 `adaptiveTopK(question: string): number`）
- 不动外部 SSE 事件 / API contract
- 调用方（`runRagPipeline` 内 Step 1）零适配
- 改动量 ≤ 30 行（含注释）

按 CLAUDE.md 工作流分类，这种 micro tuning 走 C `superpowers-feature-workflow`：
"不需要产出供他人消费的契约 / 不涉及跨人接口"。

## 与 A condense 的关系

A condense 上线后，`adaptiveTopK` 看到的是 `retrievalQuestion`（已改写过）。
意味着：

- 短指代型 follow-up 在 condense 阶段已经被改写成长问句，绕过 adaptiveTopK
  的"短查询"分支
- C 调优（中文短 K 5→8）只在 condense 不触发时生效（history 空 / LLM 失败 / 触发
  条件不命中）

例子：
- "什么是道？"（5 字 + history 空）→ 不触发 condense → adaptiveTopK 看到原句 →
  C 调优生效，K=8
- "原文"（2 字 + history 非空且命中 condense）→ 改写成 "请提供《道德经》第一章
  的原文" → adaptiveTopK 看到长句 → 走默认 K=10

C 调优是 condense 不触发时的"补救"。

## 实施 + 验证（C 工作流 Plan / Implement / Verify 三步）

### Plan
- [x] 改 `adaptiveTopK` 函数：拆分判断顺序 + emit reason 4 元化
- [x] export `adaptiveTopK` 供单测断言
- [x] 加 `__tests__/adaptiveTopK.test.ts` 17 用例
- [x] tsc 干净
- [x] tsx smoke：16 断言全过（4 档 K + 优先级 + 边界）

### Implement
- 文件：`apps/qa-service/src/services/ragPipeline.ts`（adaptiveTopK 函数 + Step 1
  emit reason 三元 → 四元）
- 测试：`apps/qa-service/src/__tests__/adaptiveTopK.test.ts`

### Verify
- [x] tsc clean
- [x] tsx smoke 16/16
- [ ] V-3：实测对照（user 验证后填）：
  - "什么是道？"（空 history）：之前 K=5 现 K=8；rerank top-1 应该相近，多 3
    chunk 给 LLM 综合
  - "缓冲块"（空 history，工业 SOP 文档）：同上
  - "API"（空 history）：保持 K=5（英文缩写检测分支）

## 风险 / 回滚

| 风险 | 缓解 |
|---|---|
| K 提到 8 后噪声增加 | top-1 score 不变，rerank 已经精排过；多 3 chunk 给 LLM 综合，最坏情况 LLM 自己忽略 |
| 影响延迟 | embedding 多召回 3 chunk 对 latency 影响 < 50ms |
| 回归 | revert 单个函数 +6 行代码即可 |

## 不做（明确）

- 把 K 做成 env / 运行时可调 —— 数值小+理由清晰，硬编码就行
- 加跨语种（日文/韩文）短查询特判 —— 等遇到再说
- 把短查询 K 跟 condense 触发条件联动 —— 现在两者独立，逻辑更清晰
