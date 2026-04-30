# Explore · D-002.6 factual_lookup 拒答倾向修复

> 工作流：B `superpowers-openspec-execution-workflow` · 阶段 Explore
> 目标：D-002.4 N=3 揭示 sop-数值 keywords 1/3 + pattern_type 1/3 — 2/3 LLM 拒答 "知识库中没有相关内容"

---

## 根因

**Case**：`D003-sop-数值`
- question: `alpha angle and beta angle clearance requirements`
- expected: factual_lookup, keywords ["alpha","beta"], pattern verbatim
- 失败答案: `知识库中没有相关内容 [1][2][3][4][5][6][7][8][9][10]` — **引用 10 chunks 却说没内容**

`buildFactualLookupPrompt` (answerPrompts.ts:90-101) 第 1 条：
```
1. 只使用提供的文档作答...**找不到就说「知识库中没有相关内容」**，不要猜
```

这给 LLM **过弱的拒答门槛**——"找不到就说"。LLM 看到 10 chunks 但无法精准定位 alpha/beta clearance 的具体数值时，倾向走 escape 而不是 verbatim 引用相关片段。

注意：retrieval 实际命中了对的 docs（expected_asset_ids: [1, 5]，确实是 LFTGATE-32 + Bumper Integration BP）。问题不在召回，是 prompt 让 LLM 过早放弃尝试。

---

## 改造方向（4 个备选）

### A · prompt 加"先尝试 verbatim 提取"前置

```
0. 【先尝试】扫描 [1]..[N] chunks 找出含问题关键实体（如 "alpha"/"beta"）的段落，
   完整 verbatim 引用相关片段后再判断
```

**优**：明确步骤，迫使 LLM 走 chain-of-extract 而非直接 escape
**劣**：可能过度引用——召回有但跟问题不直接相关的片段也被复述

### B · 弱化 escape：从"找不到就说"改"完全无相关实体才说"

```
原: 找不到就说「知识库中没有相关内容」
新: **只有 chunks 中完全没有出现问题的关键实体或近义词时**才说「知识库中没有相关内容」
```

**优**：抬高 refuse 门槛，要求实体级别的"完全无关"
**劣**：LLM 仍可能错判"完全无相关"

### C · 加 chain-of-thought 中间步骤

```
回答前先在脑内执行：
1. 识别问题里的关键实体/术语（如 "alpha angle", "clearance"）
2. 扫描每个 [N] chunk 是否含这些实体或同义词
3. 若任一 chunk 含 → verbatim 引用该片段
4. 若全无 → 拒答
```

**优**：明确指令；fast LLM (Qwen2.5-7B) 偶尔会走 CoT 受益
**劣**：增加 token；fast LLM 不可靠 follow

### D · A + B 组合

A 给"先尝试"步骤 + B 抬高 refuse 门槛 + 不强制 CoT

**优**：两层保险——LLM 先尝试，failure 再 refuse；门槛提高
**劣**：prompt 变长（~50 字增加）

---

## 推荐：D（A + B）

理由：
1. **A 单独**有"过度引用"风险——sop-数值 这种题召回里包含部分相关内容，正想让 LLM 引用
2. **B 单独**只是文字微调，效果可能有限
3. **C** chain-of-thought 在 fast LLM 7B 上不稳定，且增加 token
4. **D 组合**双管齐下：A 改变默认行为（先 extract），B 提高 escape 门槛

D 的 prompt diff（保留所有现有规则，仅在第 1 条扩展 + 加新前置）：

```
原 [硬性规则] 第 1 条:
1. 只使用提供的文档作答，不引入文档外的事实、背景、推断、评价。
   找不到就说「知识库中没有相关内容」，不要猜

新 [硬性规则] 第 1 条:
1. **先尝试 verbatim 提取**：扫描 [1]..[N] chunks 找含问题关键实体（数值/术语/
   人名/缩写）或同义实体的片段，完整 verbatim 引用相关片段。**只有所有 chunks
   都完全没有出现问题的关键实体或同义实体时**才说「知识库中没有相关内容」。
   不引入文档外的事实、背景、推断、评价。
```

---

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| LLM 过度引用：sop-数值 旁边的 chunks 也被 verbatim 复述 | "verbatim 引用**相关**片段"明确限定；其它 case (V3C/V3B) 已稳，过度引用风险有限 |
| 改 prompt 让其它 factual_lookup case 啰嗦化 | env 守卫 `FACTUAL_STRICT_VERBATIM_ENABLED`（默认 true），false 走旧 prompt 一键回滚 |
| LLM 仍然 refuse | acceptance 不强求 100%——≥ 2/3 命中 alpha/beta 即可（与 D-002.5 V3D 同标准） |
| 影响 N=2 self-consistency 行为 | sop-数值 走的是 generateAnswer chatStream 单调用流式，不走 kbMetaHandler N=2 路径 — 互不冲突 |

**回滚**：env `FACTUAL_STRICT_VERBATIM_ENABLED=false` → 走旧 prompt。

---

## 不在范围

- 改 retrieval / rerank 算法（召回已经命中对的 docs）
- 改 language_op / multi_doc_compare / kb_meta / out_of_scope 模板（不在抖动范围）
- 修 V3E / cn-fact 抖动（D-002.3 LLM 抖动，独立问题）

---

## Acceptance

1. sop-数值 `--repeat 3` keywords 命中率 1/3 → ≥ 2/3
2. 不回归 V3C / V3B / sop-中英 等 industrial_sop_en 其它 case
3. env=false 重跑 → 行为回到 baseline 8（sop-数值 1/3）

---

## 工作量估算

| 阶段 | 时间 |
|---|---|
| Lock OpenSpec | 10 min |
| Execute prompt + env 守卫 + 测试 | 15 min |
| Verify | 10 min |
| Archive | 5 min |
| **合计** | **~40 分钟** |
