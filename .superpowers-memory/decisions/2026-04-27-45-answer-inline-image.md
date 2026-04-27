# ADR 2026-04-27-45 · 答案气泡内嵌图片（关闭 OQ-ANSWER-INLINE-IMAGE）

## Context

ADR-44 把 `Citation.image_id` / `image_url` 透到 trace.citations，前端"引用"右栏卡片已经能渲染 64×64 缩略图。但用户 2026-04-27 当面反馈：**"我需要回复的时候有相关的图片"**——指答案气泡（左侧主对话）正文里直接嵌图，不只是右侧引用区。

发现两个前置事实让 OQ 写时的"地基靠谱"假设站不住：

1. **MarkdownView 不支持 image markdown**（`apps/web/src/components/MarkdownView.tsx` 文件头明确写"不支持：嵌套列表深度 >1、表格、图片、HTML 直传、脚注、math"）。
2. **AiBubble 完全是纯文本渲染**（`apps/web/src/knowledge/QA/index.tsx:240-244`），用 `whiteSpace: 'pre-wrap'` 直接吐 `msg.content`，连 `[N]` 都没做超链接。

直接接 react-markdown / 扩展 MarkdownView 都过 scope（违反"独立 UI 细节"的 C 类工作流约束）。**最小动作**：写一个专一组件 `AnswerContent`，只解析 `![alt](/api/assets/images/<id>)` 一种 pattern，严格 URL allow-list 防 XSS。

工作流：C `superpowers-feature-workflow`（Explore → Plan → Implement → Verify · 跳过 OpenSpec 归档）。

## Decision

### D-001 后端：prompt 注入 + flag 守门，不做 LLM 输出后校验

**`apps/qa-service/src/services/ragPipeline.ts`** 三处改动：

1. **`docContext` 拼接增强**：每个 chunk 头部下若 `kind='image_caption'` 且 `image_id > 0`，多吐一行 `IMAGE: /api/assets/images/<id>`。LLM 看到这行才知道有图可用。
2. **`defaultSystem` 新增规则 6**（条件加，仅在 inlineImageEnabled && hasImageDocs 时拼）：
   > 如果某个 [N] 文档片段紧跟有 `IMAGE: /api/assets/images/<id>` 行，且该图能直接说明你的答案，可以在引用 [N] 后立刻换行写一行 markdown `![简短描述](/api/assets/images/<id>)`。**严格规则**：(a) URL 必须照抄 IMAGE: 行的字面值，禁止编造任何 image_id；(b) 文档片段没有 IMAGE: 行就不要插图；(c) 图与文字相辅相成，不要为了插图而插图。
3. **新 env flag `INLINE_IMAGE_IN_ANSWER_ENABLED`**（默认 `true`）：关时 `docContext` 不出 IMAGE: 行、prompt 不加规则 6——LLM 不知道有图存在；前端 AnswerContent 仍会运行但 LLM 不会输出可解析的 markdown。**与 `CITATION_IMAGE_URL_ENABLED` 完全独立**——"图在答案"和"图在引用区"两路互不绑定。

**为什么不做 LLM 输出后校验**：

- ragPipeline.generateAnswer 是**流式**的（`for await (const text of stream)`），post-stream 校验会破坏首字延迟体验
- 防幻觉的真正第一道防线是 **prompt 端只暴露真实 image URL**——LLM 没有素材编造
- 第二道防线是**前端严格 URL allow-list**（见 D-002），即使 LLM 偶尔越界写了无效 URL，前端也会退化成纯文本
- 一旦体感发现 LLM 大量幻觉，再加 backend 校验也来得及（trade-off 写在"后续路径"）

### D-002 前端：新组件 `AnswerContent` + 严格 URL allow-list

**`apps/web/src/knowledge/QA/AnswerContent.tsx`** 新建（约 100 行）：

- `parseAnswerSegments(content): Segment[]` —— 用 regex `/!\[([^\]]*)\]\(([^)\s]+)\)/g` 切出 `(text|img)` 段
- **安全 URL allow-list**：`/^\/api\/assets\/images\/\d+$/` 严格匹配，**任何**外部 URL / `data:` / `javascript:` / 非数字 id / query / fragment / 路径继续都退化为纯文本字面量
- 流式兼容：未闭合的 `![](/api/assets/images/42`（缺 `)`）regex 不匹配，整段当 text；token 到齐再 re-render
- 渲染：`<img>` 带 `loading="lazy"`、`onError` 兜底替换为"[图片加载失败]"提示文字、点击新 tab 看原图、`max-height: 360px`

**`AiBubble`（`QA/index.tsx`）** 用 `<AnswerContent content={msg.content} />` 替换原 `{msg.content}` 纯文本渲染。其余结构不变（光标动画、trace 展开等）。

### D-003 不动 Notebooks ChatPanel / Agent index.tsx

它们各自有独立的 message 渲染逻辑（`AssistantContent` / 直接 `{msg.content}`），如果用户后续要求"那两个面板也内嵌图"，再单独走 C 类。本次 scope 严格控制在 QA 主对话页，对应用户给的截图。

### D-004 测试覆盖

- `apps/qa-service/src/__tests__/inlineImagePrompt.test.ts`：env 解析 5 case + 与 CITATION_IMAGE_URL_ENABLED 独立性
- `apps/web/src/knowledge/QA/AnswerContent.test.tsx`：parse 切分 14 case，含 XSS 防御（javascript: / data: / 外部 URL / path traversal / query / fragment 一律退化）

## Consequences

### 正向

- 用户体感诉求直接闭环：答案气泡左下方就有图，不需要再看右栏 citation 区
- 严格 URL allow-list 设计让 XSS / 幻觉 URL 进不来
- flag 默认 on 但完全可关——`INLINE_IMAGE_IN_ANSWER_ENABLED=false` 即刻退回"纯文本答案 + 右栏 citation 缩略图"形态，与 ADR-44 状态等价
- 与 ADR-44 / ADR-35 三条配合：图片输入（ADR-35 multimodal）→ 图片召回（ADR-44 Citation 透图）→ 图片在答案里（本 ADR）一条端到端

### 负向 / 取舍

- 没做 backend post-stream 校验，依赖前端 allow-list 兜底——若未来 prompt 有 regression（譬如系统提示被某次 hot-fix 改坏，LLM 大量编造），前端会大量出现退化为纯文本字面量。需要在 OQ-ANSWER-INLINE-IMAGE-MONITOR 里加观测点
- AnswerContent 是 QA 专属，复用边界不大（Notebooks / Agent 各有独立 bubble）
- 流式半截 markdown 体感：用户在 token 流过程中**会**短暂看到"![](/api/asse"这种文字，约 100-200ms 后图片完整出现并替换。可接受但不完美

### 后续

- 留 OQ-ANSWER-INLINE-IMAGE-MONITOR：触发=统计连续 1 周 LLM 输出违反 allow-list 的次数 > 5%，启动 backend post-stream 校验或 prompt re-tune
- Notebooks/Agent 两个面板的复用：等用户在那两条线提同样需求再启动；本次不主动做

## Files

新增：
- `apps/web/src/knowledge/QA/AnswerContent.tsx` (~100 lines)
- `apps/web/src/knowledge/QA/AnswerContent.test.tsx` (14 case)
- `apps/qa-service/src/__tests__/inlineImagePrompt.test.ts` (5 case)
- `.superpowers-memory/decisions/2026-04-27-45-answer-inline-image.md`（本 ADR）

修改：
- `apps/qa-service/src/services/ragPipeline.ts`（docContext + isInlineImageInAnswerEnabled + 规则 6）
- `apps/web/src/knowledge/QA/index.tsx`（AiBubble 接 AnswerContent + import）
- `.superpowers-memory/open-questions.md`（OQ-ANSWER-INLINE-IMAGE 关闭，迁到顶部已关闭区）

## Links

- 关闭的 OQ：`.superpowers-memory/open-questions.md#OQ-ANSWER-INLINE-IMAGE`
- 上游 ADR-44（Citation 透图）：`.superpowers-memory/decisions/2026-04-27-44-lance-borrowing-asset-vector-coloc.md`
- 相关 ADR-35（多模态 image input）：`.superpowers-memory/decisions/2026-04-26-35-qa-web-search-and-multimodal.md`
- C 类工作流定义：`.claude/commands/superpowers-feature-workflow.md`
