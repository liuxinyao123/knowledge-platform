# Explore · D-002.4 RAG generateAnswer majority-of-N

> 工作流：C `superpowers-feature-workflow` · 阶段 Explore
> 目标：治 baseline 8 残留的 generateAnswer 侧 LLM 抖动（V3A keyword「数据权限」/ V3D keyword「LFTGATE」/ sop-数值 pattern verbatim / V3A transparency declaration）

---

## 问题陈述

D-002.3 之后 baseline 8 的 V-3 三跑显示 intent 维度已稳到 100%，但每跑都还有 **1~2 case 在 generateAnswer 侧抖**：

| 维度 | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| keywords | 11/11 ✓ | 9/11（V3A 数据权限 + V3D LFTGATE 缺）| 11/11 ✓ |
| pattern_type | 12/12 ✓ | 12/12 ✓ | 11/12（sop-数值 verbatim 缺数值+单位）|
| transparency | 6/6 ✓ | 6/6 ✓ | 5/6（V3A 末尾未声明）|

这些都不是系统设计问题——是同一 prompt 同一 retrieval 召回，LLM **每次生成的措辞不同**：有时引用了「数据权限」，有时用了「3 个治理子模块」概称；有时引用 LFTGATE-32 文件名，有时只列 Bumper PDF。LLM 抖动是 free-form generation 的固有特性，单次采样无法消除。

---

## 核心约束：流式 vs majority-of-N

```ts
// 当前 generateAnswer 的核心循环（ragPipeline.ts:584-587）
for await (const text of stream) {
  if (signal.aborted) break
  emit({ type: 'content', text })   // 逐 token 实时推前端
}
```

majority-of-N 需要拿到 ≥ 2 个完整答案才能开始投票，**与流式 UX 直接冲突**。绕开这个冲突有几条路，下面列出。

---

## 4 个备选路径

### 路径 1 · 产线 N=3 串行非流式

```
chatComplete × 3（顺序）→ vote(answers) → emit 整段答案
```

| 维度 | 评估 |
|---|---|
| 修复 production 答案质量 | ✅ 直接修 |
| Wall-time 延迟 | **3×**（用户等待感受最差）|
| 前端 UX | ❌ 失去打字机效果，整段一次性出现 |
| Token 成本 | 3× input + 3× output |
| 实现复杂度 | 中（vote 机制要单独设计）|
| 回滚 | env 守卫一键回旧 chatStream |

### 路径 2 · 产线 N=3 并行非流式

```
Promise.all([chatComplete, chatComplete, chatComplete]) → vote → emit 整段
```

| 维度 | 评估 |
|---|---|
| 修复 production | ✅ |
| Wall-time 延迟 | **~1×**（max of 3 ≈ 单次延迟）|
| 前端 UX | ❌ 同样失去打字机 |
| Token 成本 | 3× |
| 实现复杂度 | 中 |
| 系统压力 | LLM API 突发并发 3×，硅基免费层有 RPM 限流风险 |

### 路径 3 · 流式 + post-hoc keyword 检查 + 补救

```
chatStream 1 次正常流式 emit
└── 流结束后用 fast LLM 检查"答案是否含核心信息"
    ├── 通过 → done
    └── 缺 → 后台再调 N-1 次 chatComplete，vote 后 emit "已修订" 替换
```

| 维度 | 评估 |
|---|---|
| 修复 production | 部分（仅 keyword/pattern 类）|
| Wall-time 延迟 | 1.x×（命中 fast path 时不变）|
| 前端 UX | ⚠️ 答案出完一会儿后被替换——需要新前端协议 `type: 'content_revised'` |
| Token 成本 | 命中 fast path 1×；触发补救时 1.x~2× |
| 实现复杂度 | **高**（前端 + 后端 + 协议三处都要改）|
| 风险 | "答案修订" 心智模型容易困扰用户；何时触发补救的判定阈值难调 |

### 路径 4 · 离线 only（评测器侧 N=3 取众数）

```
scripts/eval-multidoc.mjs:
  for case:
    answers = [run_once() for _ in range(3)]
    vote_assert(answers, expectations)  # 取 3 次中至少 2 次满足才算 PASS
production generateAnswer 不动
```

| 维度 | 评估 |
|---|---|
| 修复 production | ❌ 不修 |
| Wall-time 延迟 | 0（生产不动）|
| 前端 UX | ✅ 完全不变 |
| Token 成本 | 评测时 3×；生产 0 |
| 实现复杂度 | 低（仅改评测脚本）|
| 价值 | 把 LLM 抖动从评测分数里 statistical-smooth 掉，区分"系统问题"vs"运行时方差"——明确未修 case 的真实性质 |

---

## Vote 机制（如果选 1/2/3）

free-form 答案没有简单"众数"概念。备选：

| 机制 | 说明 | 评估 |
|---|---|---|
| (a) 评测要素分 | 运行时 assert keywords/pattern，选命中最高 | ❌ production 不知道每个问题该 assert 什么——耦合评测集 |
| (b) Judge LLM | 让 fast LLM 比较 3 个答案"哪个最完整" | ⚠️ 多 1 次 LLM 调用；判别标准模糊 |
| (c) **Consensus LLM** | 把 3 个答案丢给 LLM"综合出一个最完整答案" | ✅ 业界常见 self-consistency 变体；产出确定 |
| (d) 字符长度 / chunk 重叠 | 取最长 / 重叠最多 | ⚠️ 长 ≠ 好；重叠多 ≠ 准确 |

推荐 (c) Consensus LLM：拿 3 个 candidate answers + 原 question + retrieved docs 给 fast LLM，让它"基于这 3 个候选合成一个最完整且基于文档的最终答案"。本质是 chain-of-verification 的简化版。

---

## 我的推荐

**先做路径 4，观察 1 周后再决定要不要做 1/2**。

理由：

1. **路径 4 几乎零成本**，仅改评测脚本——能立刻把 baseline 8 残留 case 性质拍板（"3 次中 2 次过 = LLM 抖动；3/3 都过不去 = 系统问题"）
2. **路径 4 的数据能给路径 1/2 提供决策依据**：如果 V3A 三跑里有 2/3 过 keyword，那"production 加 majority"的 ROI 高；如果 0/3 过，说明 prompt 模板根本不强制提"数据权限"，加 N 调用也救不回——该改 prompt
3. **路径 1/2 一旦上 production，UX 退步是不可逆的预期管理**——失去打字机效果用户会抱怨
4. **路径 3 太复杂**，前端/后端/协议都要改，1 小时做不完，C 工作流不合适

但 user 选 A 时的措辞是"治残留 generateAnswer 抖动 + production 修复"。如果 user 坚持要 production 侧 majority，我建议**路径 2 并行 + Consensus LLM**，1× wall-time 代价能接受。

---

## 三个具体落地方案（让 user 拍板）

| 方案 | 路径 | 工作量 | 修复 production | 主要代价 |
|---|---|---|---|---|
| **方案 X** | 路径 4 离线 only | ~30 分钟 | ❌ | 0（仅诊断）|
| **方案 Y** | 路径 4 + 路径 2 并行 + Consensus | ~1.5 小时 | ✅ | 失去 streaming UX + 3× token |
| **方案 Z** | 路径 4 + 路径 3 流式补救 | ~3 小时（C 工作流不合适，要升 B）| 部分 | 协议+前端 改造 |

---

## 风险与回滚（任一方案共有）

| 风险 | 缓解 |
|---|---|
| LLM 突发并发被 RPM 限流（路径 2）| Promise.all 包 try/catch；任一失败回单调用结果 |
| Consensus LLM 抖出"不基于原文"的内容 | system prompt 强约束「只能从这 3 个候选里选最完整的，不要新加内容」+ assert vs 原 docs |
| token 成本 3× | env `ANSWER_MAJORITY_N` 默认 1（off），3 表示 N=3；生产可灰度逐步开 |
| 失去 streaming 用户抱怨 | env 守卫一键回旧 chatStream；可加 fast UI placeholder（"正在审核 3 个候选答案..."）改善等待感 |

---

## 不在范围

- 升级 LLM 模型（72B → 更大）：改善 LLM 质量但不属本特性
- 改 prompt 模板让 LLM 更稳：属于 D-002.1 改造，与本特性正交
- D-003 评测集扩大：选项 D，独立工作

---

## 工作量估算

| 方案 | 阶段拆 | 时间 |
|---|---|---|
| X | Plan + 改 eval-multidoc.mjs + verify | 30 分钟 |
| Y | Plan + 改 ragPipeline + 加 voteByConsensus + tests + eval | ~1.5 小时 |
| Z | 升级到 B 工作流，超 C 工作流范围 | 3+ 小时 |
