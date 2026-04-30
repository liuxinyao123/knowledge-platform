# Proposal · D-002.6 factual_lookup 拒答倾向修复

## What

**v1（探索归零，default off）**：保留 prompt 改造架构 + env 守卫，但 default `false`——生产仍走 legacy prompt。改造内容：`buildFactualLookupPrompt` 第 1 条规则从"找不到就说" 改成"**先尝试 verbatim 提取**...只有所有 chunks 完全无问题关键实体时才拒答"。

## Why

D-002.4 N=3 揭示 sop-数值 case："alpha angle and beta angle clearance requirements" 期望 keywords ["alpha","beta"]，2/3 跑里 LLM 输出 `知识库中没有相关内容 [1][2][3][4][5][6][7][8][9][10]` —— 引用 10 chunks 却说没内容。retrieval 已命中正确 docs (LFTGATE-32 + Bumper Integration BP)，问题被假设为 prompt 给的 escape 门槛过低。

## A4 Verify 反直觉发现 → default 改 false

A4 实测打脸了原假设：

| Sample | 路径 | sop-数值 keywords / pattern_type |
|---|---|---|
| 单 case `--repeat 3` | env=true (新 prompt) | 2/3 / 1/3 → BROKEN |
| 单 case `--repeat 3` | env=false (legacy) | **3/3 / 3/3 → STABLE** |

**严格 prompt 反而更易拒答**——可能因为 fast LLM (Qwen2.5-72B) 对长复杂指令解析不佳，被 fallback 短语 `知识库中没有相关内容` prime 了。简单 legacy prompt "找不到就说" 反而让 LLM 更愿意做"部分回答 + 引用 verbatim 数值"。

**决策**：保留 D-002.6 v1 的代码架构（env 守卫 + 双 prompt 路径 + 测试）作 opt-in 实验通道；default 翻成 `false` 让生产走 legacy prompt。等 D-002.7 重新设计 prompt（candidate：few-shot 示例 / chain-of-extract 步骤拆分 / system-then-user 结构调整）。

## What changes

1. **修改** `apps/qa-service/src/services/answerPrompts.ts` `buildFactualLookupPrompt`：
   - 第 1 条规则按 env 分支：`true` 走严格版（先 verbatim 提取）；默认走 legacy 版
   - 其它 4 条规则（禁模糊措辞 / verbatim 数值 / [N] 引用 / 不漏组件）不动
2. **新增** env `FACTUAL_STRICT_VERBATIM_ENABLED`（**默认 `false`**，A4 verify 后翻转）—— `true / 1 / on / yes` 显式启用 opt-in 实验
3. **修改** `apps/qa-service/src/__tests__/answerPrompts.test.ts`：加 case 验证 env=true 走新 prompt + 默认走 legacy

## Out of scope

- 其它 4 个 intent prompt 模板（language_op / multi_doc_compare / kb_meta / out_of_scope）
- retrieval / rerank 算法
- D-002.3 V3E intent 抖动 / cn-fact intent 抖动

## Acceptance（v1 探索归零版）

1. ✅ vitest answerPrompts.test.ts 全过 + 整套零回归 (D-002.6 涉及测试 24/24)
2. ✅ tsc exit 0
3. ✅ V3C / V3B / sop-中英 不回归（A4 实测全 STABLE）
4. ⚠️ sop-数值 keywords ≥ 2/3：跨 sample 平均 78% 命中（acceptance 部分达成；但 env=false 单 sample 反而 3/3）
5. ⚠️ env 翻转方向：default off 让生产保持 legacy 行为，env=true 是 opt-in 实验通道
6. 📋 留 D-002.7：重新设计 prompt 的方向待定（few-shot / CoT / 结构调整）
