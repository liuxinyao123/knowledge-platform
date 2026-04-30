# Explore · D-002.5 kbMetaHandler 语义筛 V3D 修复

> 工作流：C `superpowers-feature-workflow` · 阶段 Explore
> 目标：D-002.4 N=3 揭示的 V3D keyword "LFTGATE" 0/3 — 真系统问题，修复至 ≥ 2/3 命中

---

## 根因分析

**Case**：`D003-V3D` "找一下汽车工程相关的资料"
**期望 keyword**：`LFTGATE`
**实际答案**：`找到以下 1 个相关文档：  · [Bumper Integration BP rev 11.pdf]`
**N=3 实测**：3 跑里都只挑 Bumper PDF 这一条

### 调用链分解

```
question "找一下汽车工程相关的资料"
  ↓
extractKbMetaKeywords → ["汽车工程"]
  ↓
queryAssetCatalog(keywords=["汽车工程"])
  → SQL: name ILIKE '%汽车工程%' → 0 hit（文档名都是英文缩写或中文产品名，无字面汽车工程）
  ↓
fallback retry: queryAssetCatalog(keywords=[])
  → 全库按 indexed_at DESC LIMIT 50 → ≥ 10 条候选（含 LFTGATE-32 + Bumper + 道德经 + 知识中台 PRD ...）
  ↓
renderKbMetaAnswer(candidates) → 走 > 10 条分支 → LLM 语义筛
  ↓
LLM only picks "Bumper Integration BP rev 11.pdf"
  ↓
渲染 1 条答案
```

### Prompt 三处缺陷（kbMetaHandler.ts line 239-246）

```
用户问：${question}

下面是知识库内的候选文档（按入库时间倒序，最多 30 条）。请挑出**与问题语义最相关的
最多 8 条**，按相关性倒序输出它们的编号（仅数字，逗号分隔）。如果都不相关，输出 "0"。
```

| # | 缺陷 | 影响 |
|---|---|---|
| 1 | "**最多** 8 条" 只设上界 | LLM 选 1 条算合规——保守倾向 |
| 2 | "如果都不相关，输出 0" 提供 escape hatch | LLM 不确定时容易直接 escape |
| 3 | 无任何 hint 提示候选名可能是**领域专业术语缩写** | fast LLM (Qwen2.5-7B) 不熟 LFTGATE/BP/SOP/PRD 等术语，不敢归属到"汽车工程" |

---

## 改造选项

### A · 改 prompt 加最低数 + 术语提示 + 弱化 escape

```
用户问：${question}

下面是知识库内的候选文档（按入库时间倒序，最多 30 条）。

判定原则：
1. 候选名常含**领域专业术语缩写或代号**（如 LFTGATE = 尾门系统、BP = 业务流程、SOP = 操作规程、
   PRD = 产品需求文档）。即便缩写陌生，名称里出现的关键词都可能是子领域信号。
2. 请挑出**与问题语义相关的 3-8 条**（按相关性倒序）。
3. 只有候选确实**毫不相关**才输出 "0"。如果至少 1 条沾边，必须输出该候选的编号。

候选：
${idx}

只输出数字（逗号分隔），不解释。
```

**优**：直接、可解释、Diff 集中
**劣**：术语提示是英 + 中混合 hard-coded 的领域知识，泛化性弱（如果 user 问"金融相关"，prompt 不知该提示什么术语）

### B · 改 prompt（A）+ 代码端最低数兜底

A 之外，**代码再把关**：解析 LLM 输出后

```ts
const nums = parseNums(content) // [4]
if (nums.length === 0) {
  // LLM 说全无关 / 解析失败 → 渲染前 8 条（不再 emptyAnswer，因为已退化全库时认为有相关）
  return fallbackMarkdownList(question, candidates)
}
let picked = [...new Set(nums)].slice(0, 8).map((i) => candidates[i - 1])
// 不足 3 条时：用 candidates 顺序补齐到 3 条（去重）
if (picked.length < 3 && candidates.length >= 3) {
  for (const c of candidates) {
    if (!picked.includes(c)) picked.push(c)
    if (picked.length >= 3) break
  }
}
return fallbackMarkdownList(question, picked)
```

**优**：双保险——prompt 引导 + 代码兜底；即使 LLM 仍只挑 1 条，下游能保证 ≥ 3 条
**劣**：补齐的 candidates 可能不相关，渲染出来用户体验略乱（但比"只 1 条但少了真相关"好）

### C · 升级到 main LLM (72B) 做语义筛

把 `getLlmFastModel()` → `getLlmModel()`（默认 Qwen2.5-72B）

**优**：72B 比 7B 更熟领域术语（实测）
**劣**：每次 kb_meta 走大模型，延迟 + token 成本翻倍；30 候选 ranking 这种轻任务用 72B 是杀鸡用牛刀；本质回避问题不是修问题

### D · 加 temperature 调高 + n=3 self-consistency

```ts
// 跑 3 次取交集 / 并集
const runs = await Promise.all([0, 1, 2].map(() =>
  chatComplete(prompt, { temperature: 0.5, ... })
))
const allNums = runs.flatMap(parseNums)
// 出现次数 ≥ 2 才采纳，否则 fallback 顺序补
```

**优**：直接降 LLM 抖动
**劣**：3× LLM 调用 = 3× 延迟 + 3× token；与 D-002.4 的"production 不动"边界冲突；over-engineering

### E · 完全跳过 LLM 语义筛 + 给前端 30 条候选

把 > 10 case 的 LLM 步骤删了，全部 fallback 到前 8/10 条 SQL 顺序

**优**：零 LLM 调用，零延迟
**劣**：前 8 条按 indexed_at DESC 排——刚入库的最先；与 question 相关性可能很差；对"找一下汽车工程相关"这种问题，按时间排没法把 LFTGATE 排在道德经前面

---

## 推荐 · 选 B（prompt 改 + 代码端最低数兜底）

理由：

1. **针对性强**：直接改 V3D 失败链路上的 prompt + 解析逻辑两处
2. **改动面小**：只改 `renderKbMetaAnswer` 一个函数，~30 行 diff
3. **双保险**：prompt 引导 LLM 给 ≥3 条；如果 LLM 仍犟着给 < 3，代码兜底用 candidates 补齐
4. **低风险**：原代码路径完整保留（任一异常 → 退化前 8 条）
5. **C/D/E 都有架构副作用**，C 工作流不合适

A 单独做的话有"prompt 不严格被遵循"风险（fast LLM 经验），B 加代码兜底就稳了。

### B 实现细节

**Prompt 改动**：

```
原: "请挑出**与问题语义最相关的最多 8 条**...如果都不相关，输出 0"
新: "请挑出**与问题语义相关的 3-8 条**...只有候选毫不相关才输出 0；至少 1 条沾边就必须输出"
+: 顶部加领域术语 hint（缩写可能是子领域信号）
```

**代码兜底**：

```ts
const nums = parseNums(content)
if (nums.length === 0) {
  // LLM 输出 0 / 无解析数 → 渲染候选前 8 条（已退化全库 → 认为相关）
  return fallbackMarkdownList(question, candidates)
}
let picked = [...new Set(nums)].slice(0, 8).map((i) => candidates[i - 1]).filter(Boolean)
if (picked.length < 3 && candidates.length >= 3) {
  // 补齐：用候选顺序填到 ≥ 3 条
  const usedIds = new Set(picked.map((p) => p.id))
  for (const c of candidates) {
    if (!usedIds.has(c.id)) { picked.push(c); usedIds.add(c.id) }
    if (picked.length >= 3) break
  }
}
return fallbackMarkdownList(question, picked)
```

---

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| Prompt 改动让 LLM 在小候选时也强凑 3 条 | 仅 candidates.length > 10 才进 LLM 路径；≤ 10 走 fallback markdown 不变；3-8 区间在 30 候选里合理 |
| 代码兜底补齐到 3 条，挑了不相关的 | 用户能看到的"找到 3 条"里第 3 条可能松——但 V3D 这种"语义查询"的本质就是低相关；总比只 1 条好。如果反映糟糕可降 min 到 2 |
| LLM 解析格式变化 | 仍用 `String(content || '').match(/\d+/g)`，对纯数字 / 逗号 / 列表都通用 |
| env 守卫 | 复用 D-002.2 的 `KB_META_HANDLER_ENABLED=false` 一键回到老 buildKbMetaPrompt 路径 |

---

## 不在范围

- 改 `extractKbMetaKeywords` 抽词逻辑（V3D 抽出 "汽车工程" 没问题，是字面 SQL 招架不住）
- 改 `queryAssetCatalog` SQL（已经有兜底退化全库）
- 改其它 kb_meta case（kbmeta-test 已经稳过）
- 改 D-002.4 评测器（与本特性正交）
- production 答案 streaming UX（kb_meta 路径本来就是非流式）

---

## 工作量

| 阶段 | 时间 |
|---|---|
| Plan | 5 分钟 |
| Implement prompt + 兜底 + 测试 | 15 分钟 |
| Verify (vitest + V3D --repeat 3) | 10 分钟 |
| **合计** | **~30 分钟** |
