# ADR 2026-04-23-22 · RAG Relevance Hygiene Lock（BUG-01 批 E）

## Context

2026/4/23 自动化测试 BUG-01：AI 回答"知识图谱是什么"只输出两字"知识"；trace reranker 前 5 分数全 `0.00`，引用置信度 `0%`。

根因定位靠用户本机 curl SiliconFlow 拿到决定性数据：
- 字段名是 `relevance_score`（代码 L109 匹配） → 假设 H1（API 字段漂移）反证
- 相关文档返 0.9996，无关文档返 1.66e-5 → **API 正常**
- UI 用 `toFixed(2)` 把 1.66e-5 显示成 "0.00" → **显示层掩盖真实量级**
- 库里 chunk 不少是 OCR 碎片 / JSON error body（批 D 同源）→ reranker 对乱码打超低分是**正确行为**

Lock scope 按用户选择定为 A+B+C+D+D3 五层一起修。

## Decision

### D-001 · UI 分数分三档显示（A）

`formatRelevanceScore(s)` 纯函数：
- `s ≥ 0.5` → `toFixed(2)`（0.99）
- `s ≥ 0.01` → `toFixed(3)`（0.049）
- `s < 0.01` → `toExponential(2)`（1.66e-5）
- 非数字 → `'—'`

前端 `<ConfidenceBadge>` 按同一 bucket 分 `high / medium / weak / none` 四档 pill 颜色 + tooltip 原始分。

### D-002 · 相关性阈值 WARN（B）

`RELEVANCE_WARN_THRESHOLD` 常量，env `RAG_RELEVANCE_WARN_THRESHOLD` 可覆盖（范围 [0, 1]，非法回落 0.1）。rerank 成功分支 top-1 < 阈值时 emit 额外 `rag_step ⚠️` 事件，不阻断流程。

### D-003 · textHygiene.ts 抽取（C 前置）

批 D 的 `looksLikeOcrFragment` 从 `services/tagExtract.ts` 抽到独立 `services/textHygiene.ts`，并新增 `looksLikeErrorJsonBlob` + `isBadChunk` 综合判定。`tagExtract.ts` 改 import 自新 util，行为不变（批 D 单测不回归）。

### D-004 · ingest chunk gate（C）

`services/ingestPipeline/pipeline.ts::writeFields` 循环前用 `isBadChunk(c.text)` 预判：L3（embed 粒度）bad → 跳 INSERT + 从 embed 列表剔除；L1（顶层摘要）不过滤。统计 `filterReasons` 打日志。不改 DB schema。

### D-005 · 清库脚本双脚本（D）

- `scripts/cleanup-bad-chunks.sh`（bash + docker psql）：SQL regex 抓 `too_short` + `error_json_blob`；默认 dry-run；`--confirm` DELETE
- `scripts/cleanup-bad-chunks-ocr.mjs`（node + pg）：连 PG 逐行跑 `isBadChunk`，抓 SQL 判不掉的 OCR 碎片；同样 dry-run + `--confirm`
- **不自动重 embed**；输出提示受影响 asset 需手动重跑 ingest

### D-007 · H3 Short-circuit · 低相关直接跳过 LLM（补丁 · 2026-04-23 晚）

用户截图验收 A/B/C 都生效后发现 H3（答复"知识"两字截断）仍然复现 —— 因为 reranker 返的 top-1 也是 1.68e-4 量级（库里全 OCR 乱码），LLM 吃进去的 context 全是噪声，被卡住只吐两字。

修法：`runRagPipeline` 在 `generateAnswer` 前加 short-circuit：
- 条件：`isRerankerConfigured() && finalDocs[0].score < RAG_NO_LLM_THRESHOLD`（默认 0.05；env 可覆盖）
- 动作：不调 LLM，直接 emit 一段兜底 content（多段"流式"分发 + 排查建议 + 推荐去检索/资产目录）
- 事件结构：emit `rag_step ⛔`（label 写明 top-1 分数和 "跳过 LLM"）+ 多段 `content` + `trace` + `done`
- 阈值 0.05 选择：比 B 的 WARN 阈值 0.1 更严 —— 0.05~0.1 区间仍然让 LLM 试试（可能还有点用），< 0.05 直接判定"没可用上下文"
- reranker 关时不触发 short-circuit：向量原始分数量级和 rerank 分数不同，语义不可直接阈值化

测试覆盖 5 条 Scenario：低分 short-circuit、正常不触发、reranker 关时不触发、env 覆盖生效、env 非法回落。

### D-006 · chatStream 空流守护（D3）

`services/llm.ts::chatStream`：
- 计 `yielded`
- 收到 `[DONE]` 但 yielded=0 → throw `'LLM stream returned no content chunks ...'`
- reader 自然结束但 yielded=0 → 同上
- reader 抛异常 → throw `'LLM stream interrupted: ...'`
- finally `reader.releaseLock()`

错误冒泡到 `dispatchHandler` catch → emit `error` event，前端显式显示错误气泡，不再静默截断。

## Consequences

**正面**
- Reranker 分数**真实可见**（最低的 1.66e-5 也不再被四舍五入）；用户能自己判断"系统坏 vs 库里没有"
- 新数据 ingest 时 OCR / JSON error / 短 chunk 自动挡在门外
- 老数据可以一次性清理（两种脚本覆盖 SQL 能判的 + Node 才能判的）
- LLM 上游挂了前端收到明确错误，不再"知识"两字静默停
- ingest gate / cleanup 脚本和批 D 的 tagExtract 共享同一个 `looksLikeOcrFragment`，不分叉

**负面 / 取舍**
- 清库脚本**不自动重 embed**；受影响 asset 要人手重跑 ingest。自动 re-embed job 是下一轮 change
- ingest gate 按 `chunk_level = 3`（embed 粒度）过滤；L1 摘要层短 chunk / error body 仍可能存在（用户可见性低，暂不处理）
- D3 只守护"**完全空流**"；如果 LLM 吐了 1 个 delta 然后 [DONE]（即 BUG-01 现象二："知识"两字就停），本 change 不拦
- CSS ConfidenceBadge 没抽到 `@/components/ui` 的设计系统；是快速实现

## H3 未解（答复两字截断）

Lock 阶段已定："等用户补浏览器 Network EventStream 信号后独立立 change"。三种可能：
1. LLM 真吐一字就 [DONE] → 需要 prompt 改造 + retrieve top-1 太低时走"抱歉分支"（独立 change）
2. 前端 state 管理 bug → 局部修 QA / Agent
3. SSE 中断无 error 冒泡 → D3 扩展支持中断点 detection

## 交付状态

- **sandbox 内已完成**：A + B + C + D + D3 + 单测 + 清库双脚本 + tsc 双 0（新代码 0 新错）
- **用户本机待做**：
  - `pnpm test`（新增 3 test 全绿）
  - 重启 `pnpm dev:down/up`
  - 问"知识图谱是什么"观察 trace 分数 + WARN + pill
  - 跑 cleanup 脚本 dry-run → 确认 → --confirm
  - `docs/verification/rag-relevance-hygiene-verify.md` §4 的 6 条路径

## Follow-ups

| 项 | 工作流 | 备注 |
|---|---|---|
| H3 根因定位 + 独立修复 | A / B | 等 EventStream 信号 |
| 自动 re-embed 受影响 asset | B | D 脚本不自动；给 batch job |
| L1 层 chunk 也做防脏 | C | 本 change 不做 |
| ConfidenceBadge / relevanceFormat 迁到共享设计系统 | C · UX refactor | 独立 |
| tagextract-testfix（批 D 遗留 2 条测试 drift） | C | 与 textHygiene 无关 |

## Links

- 上一轮：`2026-04-23-21-bugbatch-d-and-f.md`（批 D+F）
- OpenSpec change：`openspec/changes/rag-relevance-hygiene/`
- 归档 Explore：`docs/superpowers/archive/rag-answer-truncation/design.md`
- 验证：`docs/verification/rag-relevance-hygiene-verify.md`
