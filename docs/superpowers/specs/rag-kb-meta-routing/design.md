# Explore · D-002.2 RAG kb_meta 路由 asset_catalog

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Explore（B-1）
> 上游依赖：D-002 档 B 意图分类（已落地）/ D-003 评测集（已落地，本特性的回归基线）

## 问题陈述

D-003 baseline 4 给出的真实数据：kb_meta 类问题（"我这库里有道德经吗"/"库里有哪些汽车工程相关的资料"）通过率 **0/2**。两条都失败但失败模式不同：

| Case | 失败模式 | 根因 |
|---|---|---|
| `D003-V3D` "库里有哪些汽车工程相关的资料" | top-1 rerank 0.028 → short-circuit 兜底 | 顶层 retrieval 凉，根本到不了档 B kb_meta 分类 |
| `D003-kbmeta-test` "我这库里有道德经吗" | retrieval 命中道德经注释版本 → 档 B 误判 factual_lookup | 档 B 凭 retrieval 命中度判，而 kb_meta 本质是问"目录"不是问"内容" |

共同根因：**kb_meta 不应该走 retrieval**。retrieval/rerank 是按内容相似度排，而 kb_meta 问的是"库里有什么"——元数据级别的查询，应当直接查 `metadata_asset` 表。

## 方案概要

三层 routing：

```
question
   │
   ├── 顶层规则前置 isObviousKbMeta(q)              ◄── (1) 直接绕过 retrieval
   │       │
   │       └── 命中 → kbMetaHandler() → emit + done
   │
   ├── retrieval / grade / rewrite ...
   │
   └── 档 B answerIntent classification
           │
           └── intent === 'kb_meta'                 ◄── (2) 兜底，retrieval 已跑但不用
                   │
                   └── kbMetaHandler() → emit + done   （而不是 generateAnswer LLM 流）
```

`kbMetaHandler` 内部三步：

```
1. extractKeywords(q)               // 从问题里抽 1-3 个 LIKE 关键词
2. queryAssetCatalog(keywords, acl) // SQL: name ILIKE '%kw%' OR ...，按 indexed_at DESC
3. renderKbMetaAnswer(q, candidates)
       │
       ├── candidates.length ≤ 10   → fast LLM 包装一句引导语 + bullet 列表
       └── candidates.length >  10  → 先 fast LLM 在 candidate name 列表上做语义筛
                                       (预算 30 条 → 输出 ≤ 8 条)，再包装
```

## 决策记录

### D-1 · 检测位置 = 顶层规则前置 + 档 B fallback

替代方案：(a) 把 kb_meta 提到 AgentIntent 顶层（与 knowledge_qa 平级）。(b) 只做档 B 路由。

选 D-1 的理由：(a) 改动太大，要碰 AgentIntent 枚举 + dispatchHandler + 所有 agent 注册测试。(b) 救不回 V3D（top-level short-circuit 在档 B 之前就把 ⛔ 兜底答案吐了）。当前方案两条 case 都能修，且对 AgentIntent 零侵入。

### D-2 · Filter = name ILIKE 粗筛 + LLM 语义筛

替代方案：(a) 纯 SQL LIKE。(b) 全 LLM 在全库 name+tags 上语义筛。

选 D-2 的理由：(a) "汽车工程相关"这种语义查询 SQL 一定召不到（除非 doc name 直接含"汽车"）。(b) 全 LLM 每次 kb_meta 烧 token，库到 100+ asset 后 prompt 撑爆。两层 hybrid：常见的"找一下 X.pdf"/"我这有道德经吗" SQL 直接命中；语义查询 SQL 兜底返回 30 条让 LLM 在精简列表上挑——既准又便宜。

### D-3 · 渲染 = LLM 包装一句引导语 + Markdown 列表

替代方案：(a) 纯 Markdown 列表无引导语。(b) Markdown 表格。

选 D-3 的理由：D-003 评测集 `pattern_type=asset_list` 检测器要 `(\.pdf|.xlsx|.md|.pptx|.docx)` 后缀 + "找到以下"/"以下文档"/"建议查阅" 引导词二者**之一**就过。LLM 包装引导语两个都满足，UI 也更友好。表格在 ≤ 5 条时显得冗余。

### D-4 · 不参与 short-circuit 阈值检查

kb_meta 短路在 retrieval **之前**触发，本质上不经过 rerank/short-circuit。档 B fallback 路径里走到 kbMetaHandler 时也直接绕过 generateAnswer 的 short-circuit 逻辑。理由：kb_meta 不依赖 retrieval 命中度。

### D-5 · 不写 trace.citations

kb_meta 答案是元数据列表，不是文档内容引用。trace.citations 留空（前端引用面板自然不显示）。也不在答案里加 `[N]` 标记——eval 评测器和 UI 都不依赖。

## 关键字规则（isObviousKbMeta 草稿）

```ts
const KB_META_PATTERNS = [
  // 直接问目录类
  /(库|知识库|资料库|文档库)(里|中)?(有|是否|有没有|包不包含).*(吗|？|\?|$)/,
  /(我这|你这|当前)?(库|空间|项目)(里|中)?(有|是否).*(吗|？|\?)/,
  // 列出/查找类
  /^(列出|找一下|找出|查一下|搜一下|有哪些).{0,20}(文档|资料|文件|材料|pdf|xlsx|md|pptx)/i,
  /(有哪些|有没有).{0,15}(文档|资料|文件|材料|相关的)/,
  // 英文
  /^(list|find|search|show me).{0,30}(documents?|files?|assets?)/i,
  /(do you have|is there|are there).{0,30}(documents?|files?|on|about)/i,
]
```

设计原则：**bias to false**——宁可漏判也不要误判。漏判时档 B 兜底；误判会把正常 RAG 问题（"知识中台的核心模块有哪些"）抢走。所以正则要求"目录前缀（库/库里/有哪些 X 文档）+ 文档名词"双锚定。

## 不在范围

- 跨空间 / 跨用户的 kb_meta 查询：当前只查 ACL 允许范围内的 metadata_asset
- kb_meta 的"哪个用户上传了 X" → metadata_ops 已覆盖
- 细粒度 filter（按 ingest_status / 按 asset_type）→ 后续 D-002.4
- 资产分类标签语义 graph → 后续 N-008 / D-005

## 与 N-* + D-* 系列协同

- **D-003 eval**：本特性的回归基线 = D003-V3D + D003-kbmeta-test 必过
- **D-002**（档 B 意图分类）：复用 `classifyAnswerIntent` + `kb_meta` 枚举值
- **D-002.3**（language_op function tool）：正交，互不冲突
- **N-006 notebook 模板**：notebook 内的 chat 也走同一 ragPipeline，自动受益

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| isObviousKbMeta 误判抢走正常 RAG 问题 | 正则双锚定 + 单元测试覆盖 10+ 误判反例 |
| LLM 语义筛超时 / 无 key | 退化到全 SQL LIKE 结果（前 8 条），不阻塞 |
| name ILIKE 在 PG 大表慢 | 限 50 条 + 加 `metadata_asset_name_trgm_idx`（GIN）后续优化 |
| 整套 D-002.2 revert | env `KB_META_HANDLER_ENABLED=false` 跳过短路 + 跳过档 B kb_meta 分流，回到老 monolithic prompt |
