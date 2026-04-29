# Explore + Plan · Notebook Condense Rewrite Display（N-004）

> 工作流：C `superpowers-feature-workflow`（Explore → Plan → Implement → Verify · 跳 OpenSpec 归档）
> 上游依赖：A condense（已归档 · ragPipeline emit `🪄` rag_step "指代改写：「X」→「Y」"）
> 性质：纯前端 UI 改造；零后端改动

## 背景 + 问题

后端 ragPipeline 对短/指代型 follow-up 用 fast LLM 改写：
- 用户问"那你把原文发我"
- condense 改写成"你把《道德经》第一章的内容发给我"
- emit `rag_step` icon='🪄' label='指代改写：「那你把原文发我」→「你把...内容发给我」'
- 改写后的 query 喂 retrieval

**当前前端 UI**：
- ChatPanel `InflightBubble` 只在 `state='thinking'` 时把 ragSteps `${icon} ${label}` join 成纯文本渲染；streaming/done 阶段**完全丢失**这条信息
- QA `index.tsx` 在 `bubbleState='active'` 时显示 ragSteps 为灰色小字列表；混在思考过程里，🪄 没有特别突出

**用户痛点**：
- 用户看到答案后，不知道系统改写了自己的提问（黑箱）
- 如果改写改错了（罕见但发生），用户也无从察觉
- 透明度差 → 信任度低

## 设计

### 共享组件 `RewriteBadge` + 解析函数

```ts
// apps/web/src/components/RewriteBadge.tsx
export function extractCondenseRewrite(steps: readonly Step[]): { from: string; to: string } | null
export default function RewriteBadge({ from, to }: { from: string; to: string }): JSX.Element
```

- `extractCondenseRewrite`：从 ragSteps 数组找 icon='🪄' 项，正则解析 label 的 `「X」→「Y」` 拿 from/to
- `RewriteBadge`：轻量徽标（蓝色背景 #eff6ff + 边框 #bfdbfe），显示 "🪄 「from」→「to」" + tooltip 解释

### 接入位置

**ChatPanel `InflightBubble`**：在 thinking/streaming/done 三态都在 Bubble 上方渲染徽标
（之前 streaming/done 时 ragSteps 不渲染 → 改写痕迹丢失 bug 顺便修了）

**QA `index.tsx` 助手 bubble**：在 thinking/active/streaming/done 任意状态都在头部渲染徽标
（之前 streaming/done 时也丢失 → 同样修）

### UI 样式

```
┌──────────────────────────────────────────────────────┐
│ 🪄  「那你把原文发我」 → 「你把《道德经》第一章的内容发给我」 │← N-004 新增
└──────────────────────────────────────────────────────┘
（↓ 原助手气泡 ↓）
道可道，非常道；名可名，非常名。无名，天地之始；有名，万物之母。[^1][^2]
```

## 风险

| 风险 | 缓解 |
|---|---|
| ragSteps 没 🪄 项（condense 不触发）| `extractCondenseRewrite` 返回 null，徽标不渲染 |
| label 格式异常（正则不命中）| 同上返回 null，silent fail |
| 老消息没 ragSteps（持久化的 messages 不带 SSE 步骤）| ChatPanel 的 messages 渲染本就不接 ragSteps（只有 inflight 才有）；用户看历史时不显示徽标，预期行为 |
| QA 用 `msg.ragSteps`（已持久化 message 的字段）| ragSteps 在 QA 是 inflight 流式累积；新消息带，但前端不会把 ragSteps 写入 localStorage 之类，只在当前 session 可见 |

## C 工作流四阶段进展

- **C-1 Explore** ✓（本文档）
- **C-2 Plan** ✓（同上文档）
- **C-3 Implement** ✓
  - `apps/web/src/components/RewriteBadge.tsx`（新建）—— extractCondenseRewrite + 徽标组件
  - `apps/web/src/knowledge/Notebooks/ChatPanel.tsx` —— InflightBubble 三态都渲染徽标
  - `apps/web/src/knowledge/QA/index.tsx` —— assistant bubble 头部渲染徽标
- **C-4 Verify** —— tsc clean ✓；视觉走查待 user 跑

## 验证清单（C-4 视觉走查）

| 场景 | 期望 |
|---|---|
| Notebook 内问"那你把原文发我"（接道德经 history）| 助手气泡上方蓝色徽标显示 "🪄 「那你把原文发我」→「..._改写后_...」" |
| 全局 QA 同一 case | 同样头部显示徽标 |
| 短问题 + history 空（如"什么是道？"）| **不**显示徽标（condense 不触发）|
| 长查询型 + history 非空（如"请告诉我世界上最长的河流"）| 不显示徽标（looksLikeFollowUp 不命中）|
| condense LLM 抛异常 | 后端不 emit 🪄 → 前端不显示徽标 |
| 鼠标 hover 徽标 | 看到 tooltip："系统用 fast LLM 把你的问题改写成自洽问句以提高检索命中" |

## 与 N-* 系列的协同

- **N-001** notebook 接入档 B 后，notebook 内同样会触发 condense + 🪄 emit；徽标自动可见
- **N-002 / N-005** artifact 不走 ragPipeline，无 🪄 → 徽标无关
- **未来 D-002.x function tool** 落地后如果引入新的 SSE icon 类似事件，可复用 RewriteBadge 模式
