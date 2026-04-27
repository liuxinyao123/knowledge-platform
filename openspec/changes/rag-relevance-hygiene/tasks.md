# Tasks: rag-relevance-hygiene

顺序：A → B → C → D3 → D → E 验证。先出 textHygiene 抽取（C 的前置）给 tagExtract 共用，再依次叠加。

## A · UI 分数显示

- [ ] A-BE-1: `services/relevanceFormat.ts` 新文件 + 导出 `formatRelevanceScore(s: number): string` 纯函数（三档：≥0.5 → toFixed(2)；≥0.01 → toFixed(3)；else → toExponential(2)；非数字 → `—`）
- [ ] A-BE-2: `services/ragPipeline.ts:189` emit label 里 `score.toFixed(2)` 改为 `formatRelevanceScore(score)`；引用文档 Citation 的 score 保持原数值，前端决定显示
- [ ] A-TE-1: `relevanceFormat.test.ts` 覆盖 5 条 Scenario（高 / 中 / 低 / 0 / NaN）
- [ ] A-FE-1: `apps/web` 引用文档 pill 组件（定位：`QA/index.tsx` 或 `Agent/index.tsx` 的 `Citation` 渲染点）—— 新增 `ConfidenceBadge` 组件，输入 score 输出四档 pill（高/中/弱/几无相关）；tooltip 显示原始分数
- [ ] A-TE-2: `ConfidenceBadge.test.tsx` 四档边界（0.5 / 0.1 / 0.01）

## B · 相关性阈值 WARN

- [ ] B-BE-1: `services/ragPipeline.ts` 加常量 `RELEVANCE_WARN_THRESHOLD = Number(process.env.RAG_RELEVANCE_WARN_THRESHOLD) || 0.1`
- [ ] B-BE-2: rerank 成功分支 `if (top1 < RELEVANCE_WARN_THRESHOLD)` emit 额外 `rag_step` WARN
- [ ] B-TE-1: `ragPipeline.relevanceWarn.test.ts`：mock rerank 返 top-1=0.05 → 看到 WARN；返 top-1=0.5 → 不看到；env 覆盖阈值生效；env 非法回落 0.1

## C · 共享 textHygiene + ingest 过滤

- [ ] C-BE-1: `services/textHygiene.ts` 新文件：抽 `looksLikeOcrFragment` + 新增 `looksLikeErrorJsonBlob` + `MIN_CHUNK_CHARS=20` 常量 + `isBadChunk(content)` 综合函数
- [ ] C-BE-2: `services/tagExtract.ts` import 自 textHygiene，删除重复定义；**不改行为**（批 D 的单测继续绿）
- [ ] C-BE-3: `services/ingestPipeline/pipeline.ts` 循环里加 `isBadChunk` gate：L3 chunk bad → 跳过 INSERT；统计 `filteredCount` + `filterReasons` + `console.log` 汇总
- [ ] C-TE-1: `textHygiene.test.ts`：3 个函数的全部 Scenario（见 spec chunk-hygiene-spec.md）
- [ ] C-TE-2: `ingestPipeline.chunkGate.test.ts`：mock `embedTexts` + `pool.query`，断言 L3 bad chunk 不进 INSERT；L1 chunk 无影响

## D3 · chatStream 空流守护

- [ ] D3-BE-1: `services/llm.ts::chatStream` 加 `yielded` 计数 + try/catch/finally；空流 throw；reader 异常转 throw；finally releaseLock
- [ ] D3-TE-1: `llm.chatStream.test.ts`：mock fetch 返空流 → throw；正常流 → 不抛；非法 SSE 行不抛；reader 异常 → throw

## D · 清库脚本

- [ ] D-SH-1: `scripts/cleanup-bad-chunks.sh` 按 design.md §5.1：bash + docker exec psql；默认 dry-run；`--confirm` 触发 DELETE；DELETE 只覆盖 SQL regex 能抓的两种（too_short + error_json_blob）
- [ ] D-MJS-1: `scripts/cleanup-bad-chunks-ocr.mjs` —— 连 PG 逐行跑 `isBadChunk`（import 自 qa-service 的 textHygiene.ts）；抓 OCR 碎片；默认 dry-run；`--confirm` 才 DELETE
- [ ] D-DOC-1: 两个脚本顶部写用法 / env / 退出码，风格和 `scripts/permissions-v2-seed.sh` 对齐

## E · 验证闸门

- [ ] E-1: `cd apps/qa-service && ./node_modules/.bin/tsc --noEmit` EXIT=0
- [ ] E-2: `cd apps/web && ./node_modules/.bin/tsc --noEmit --project tsconfig.app.json` 无新错（pre-existing 5 条 RunDetail/ChatPanel 不计）
- [ ] E-3: `pnpm -r test` 本 change 新测全绿；批 D 的 tagExtract 测试不回归
- [ ] E-4: 本机冒烟 · 分数显示：
  - 重启 qa-service，问"知识图谱是什么"
  - trace 里 `Reranker 精排完成（前 5 分数: ...）` 显示**真实数字**（科学记数或三位小数），不再全 0.00
  - 如果 top-1 < 0.1 → 应看到 ⚠️ 相关性 WARN
  - 引用文档 pill 显示四档颜色 + tooltip 原始分
- [ ] E-5: 本机冒烟 · chunk gate：
  - 入库一个 OCR 扫描 PDF（故意选质量差的）
  - `docker exec pg_db psql ... 'SELECT COUNT(*) FROM metadata_field WHERE chunk_level=3 AND asset_id=<new-id>'` → 比预期 chunk 数少（gate 生效）
  - 启动日志有 `[ingest] filtered N bad chunks ...` 行
- [ ] E-6: 本机冒烟 · 清库：
  - `bash scripts/cleanup-bad-chunks.sh` (dry-run)：输出 reason 报告
  - `node scripts/cleanup-bad-chunks-ocr.mjs` (dry-run)：OCR 碎片报告
  - 任一 `--confirm` 删除后，重查报告归零
- [ ] E-7: 本机冒烟 · 空流守护：
  - 手动把 `LLM_API_KEY` 改成无效值重启（或 mock 一个立即 [DONE] 的上游）
  - 重问任何问题
  - 前端 UI 应该看到明确错误气泡"LLM stream returned no content chunks"，**不再静默只显示两字**
- [ ] E-8: 写验证日志 `docs/verification/rag-relevance-hygiene-verify.md`

## F · 归档

- [ ] F-1: `docs/superpowers/specs/rag-answer-truncation/` → `docs/superpowers/archive/rag-answer-truncation/`
- [ ] F-2: ADR：`.superpowers-memory/decisions/YYYY-MM-DD-NN-rag-relevance-hygiene-lock.md` 记 D-001~D-005 决策 + 五层改动总览
- [ ] F-3: `.superpowers-memory/integrations.md` 追加 "RAG Relevance Hygiene" 段：textHygiene / chunk gate / 分数显示约定
