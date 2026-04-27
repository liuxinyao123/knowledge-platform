# Verification · rag-relevance-hygiene (BUG-01 批 E)

> 工作流：B · D/E 阶段
> 对应 change: `openspec/changes/rag-relevance-hygiene/`
> 日期（sandbox 部分）：2026-04-23

## 1. 摘要

| 闸门 | 结果 | 备注 |
|---|---|---|
| qa-service `tsc --noEmit` | ✅ EXIT=0 | A + B + C + D3 新代码全通 |
| web `tsc --noEmit --project tsconfig.app.json` | ⚠ EXIT=2，5 条 pre-existing 无关错误；本 change 0 新错 | `RunDetail.tsx` / `ChatPanel.tsx`，React 19 遗留 |
| qa-service `vitest` | ⏸ 用户本机跑 | 新增 3 test 文件（formatRelevanceScore / textHygiene / llm.chatStream） |
| web `vitest` | ⏸ 用户本机跑 | 本批未新增 web 测试 |
| 浏览器冒烟 | ⏸ 用户本机跑 | 步骤见 §4 |
| 清库脚本 | ⏸ 用户本机跑 | 两个脚本都做了 `bash -n` / `node --check` 语法验证，EXIT=0 |

## 2. sandbox 内完成的代码改动

### 2.1 后端（5 文件）

- **新** `apps/qa-service/src/services/relevanceFormat.ts` · 分数分桶纯函数
- **新** `apps/qa-service/src/services/textHygiene.ts` · 共享 OCR / JSON-error / 短 chunk 判定
- **改** `apps/qa-service/src/services/ragPipeline.ts`
  - 引入 `formatRelevanceScore`，rerank label 不再用 `toFixed(2)`（A）
  - 新常量 `RELEVANCE_WARN_THRESHOLD`（env `RAG_RELEVANCE_WARN_THRESHOLD` 可覆盖，默认 0.1）
  - rerank 成功分支加 top-1 阈值 WARN（B）
- **改** `apps/qa-service/src/services/tagExtract.ts` · 删重复定义，改 import 自 textHygiene（保持批 D BUG-14 行为不回归）
- **改** `apps/qa-service/src/services/ingestPipeline/pipeline.ts`
  - 循环前 `skipFlags[]` 预判；L3 bad chunk 跳 INSERT；embed 列表跳过 bad chunk；日志统计 `filterReasons`（C）
- **改** `apps/qa-service/src/services/llm.ts::chatStream`
  - 加 `yielded` 计数；[DONE] / reader 自然 done 时若 yielded=0 → throw "no content chunks"；reader 异常 → throw "interrupted"；finally releaseLock（D3）

### 2.2 前端（3 文件）

- **新** `apps/web/src/components/ConfidenceBadge.tsx` · 四档 pill 组件（高 / 中 / 弱 / 几无相关 + tooltip 原始分）
- **改** `apps/web/src/knowledge/QA/index.tsx:509` · 引用 pill 改用 `<ConfidenceBadge />`
- **改** `apps/web/src/knowledge/Agent/index.tsx:474` · 同上

### 2.3 脚本（2 文件）

- **新** `scripts/cleanup-bad-chunks.sh` · bash + docker psql；dry-run 默认；`--confirm` 触发 DELETE；覆盖 `too_short` + `error_json_blob`
- **新** `scripts/cleanup-bad-chunks-ocr.mjs` · node + pg；扫 L3 → 复用 `isBadChunk` 抓 OCR 碎片；`--confirm` 才 DELETE

### 2.4 新测试（3 文件）

| 文件 | Scenario |
|---|---|
| `__tests__/relevanceFormat.test.ts` | 三档分桶 5 条 + bucket 边界 4 条 |
| `__tests__/textHygiene.test.ts` | looksLikeOcrFragment 6 + looksLikeErrorJsonBlob 5 + isBadChunk 5 |
| `__tests__/llm.chatStream.test.ts` | 立即 [DONE] 空流 / reader done 无 DONE / 单 delta 正常 / 非法 SSE 忽略 / reader 抛错 共 5 |

## 3. 根因复盘（写进本文档供日后复查）

- **UI 分数显示 bug（A）**：`ragPipeline.ts:189` 的 `toFixed(2)` 把 ≥ 6 数量级的真实分数压缩成 `"0.00"`，用户看到"前 5 分数全 0.00"误以为 reranker 坏了。用户本机 curl `https://api.siliconflow.cn/v1/rerank` 返回决定性数据：
  - 知识图谱定义 → 0.9996（正相关）
  - PostgreSQL → 0.0490
  - 苹果 → 0.0000166 ← 这条就是 UI 里的 "0.00"
- **数据源污染（C）**：库里 chunk 不少是 OCR 碎片（批 D · BUG-14 同源）+ JSON error body（批 D · BUG-02 同源）。reranker 对乱码客观打超低分是**正确行为**，不是 bug。
- **相关性可见性（B）**：之前 top-1 < 0.1 也没任何提示；用户无法区分"系统坏"vs"库里就没这东西"。现在会显式 WARN 并给三条排查方向。
- **答复两字就停（H3）**：**本 change 未根治**。D3 只做"完全空流"守护 —— 如果 LLM 真的吐了一个 delta `{"content":"知识"}` 然后 [DONE]，不会被 D3 拦住。进一步根因定位等 user 补 Network EventStream 信号后独立立 change。

## 4. 用户本机验收步骤

### 4.1 tsc

```bash
cd apps/qa-service && pnpm exec tsc --noEmit
# 预期 EXIT=0

cd ../web && pnpm exec tsc --noEmit --project tsconfig.app.json
# 预期只剩 5 条 pre-existing（RunDetail / ChatPanel）；本 change 无新错
```

### 4.2 vitest

```bash
cd apps/qa-service && pnpm test
# 预期 208/210 绿（批 D 2 条 pre-existing tagExtract 仍存在但不阻断；本批 3 个新测试全绿）
```

### 4.3 浏览器冒烟 · 分数显示 + 相关性 WARN

1. `pnpm dev:down && pnpm dev:up`（让新代码生效）
2. 打开 `/qa` 问"知识图谱是什么"
3. trace（右侧"调度详情"或 SSE rag_step）应看到：
   - `Reranker 精排完成（前 5 分数：<真实数字>）` —— 低相关分数以科学记数显示，例如 `1.66e-5 / 4.89e-5 / ...`；高相关保留 0.99 两位小数
   - 如果所有分数都低 → 下方出现 ⚠️ 相关性 WARN 红黄气泡："检索结果相关性极低..."
4. 回答区右栏"引用来源" pill 显示四档（`几无相关 · 1.66e-5` / `弱相关 · 0.049` / `中相关 · 0.250` / `高相关 · 1.00`），鼠标悬停显示完整分数

### 4.4 浏览器冒烟 · 清库 + ingest gate

```bash
# 先 dry-run 看报告
bash scripts/cleanup-bad-chunks.sh
#   预期输出三列：reason | rows | assets
#   too_short 与 error_json_blob 两种

# OCR 片段单独扫
node scripts/cleanup-bad-chunks-ocr.mjs
#   预期输出：命中数 + 涉及 asset 数 + 前 10 条预览

# 确认无误后再真删
bash scripts/cleanup-bad-chunks.sh --confirm
node scripts/cleanup-bad-chunks-ocr.mjs --confirm

# 再跑一次 dry-run 应该全归零
bash scripts/cleanup-bad-chunks.sh
```

### 4.5 浏览器冒烟 · chunk gate（ingest 防脏）

1. 入库一个已知含 OCR 碎片或扫描质量差的 PDF：`/ingest` → 文件上传
2. 等待 ingest 完成，看 `.dev-logs/qa-service.log`
3. 应该出现一行：`[ingest] filtered N bad chunks (asset=...)  { too_short: X, ocr_fragment: Y }`
4. `docker exec pg_db psql -U knowledge -d knowledge -c "SELECT COUNT(*) FROM metadata_field WHERE chunk_level=3 AND asset_id=<new-id>"` 应比 extractor 原始 chunk 数少

### 4.6 浏览器冒烟 · H3 short-circuit（D-007 补丁）

1. 不清库直接重问"知识图谱是什么"（保留用户截图里那堆 OCR 脏 chunk）
2. 预期 trace 里看到：
   - `Reranker 精排完成（前 5 分数：1.68e-4 / ...）`
   - **新增** `⛔ 检索相关性过低（top-1 = 1.68e-4），跳过 LLM 生成，改走兜底回复。`
3. 预期 AI 气泡**不再是"知识"两字**，而是：
   > 抱歉，知识库里**暂时没有**与该问题直接相关的内容。
   >
   > （检索相关性最高仅 1.68e-4，低于可用阈值 0.05）
   >
   > 可能原因：
   >   1. 该主题尚未入库；
   >   2. 已入库但文档质量偏低（扫描件 OCR 碎片 / 入库失败残留等）；
   >   3. 换种问法试试…
4. 跑完 cleanup 脚本清掉脏 chunk 后，如果你入库了真实知识图谱资料，top-1 应回到 0.5+ 范围，不再触发 short-circuit，走正常 LLM 流。

### 4.7 浏览器冒烟 · D3 空流守护

故障注入：
```bash
# 临时把 LLM_API_KEY 改成无效值（或把 LLM_BASE_URL 改成一个立即关闭连接的 mock）
# 重启 qa-service
pnpm dev:down && pnpm dev:up

# 问任何问题
# 预期前端看到明确错误气泡：
#   "LLM stream returned no content chunks..."
# 而不是静默停在 0 / 2 字
```

记得测完改回原 key / BASE_URL 再重启。

## 5. 未覆盖 · H3 (LLM 只吐 2 字就停) 的后续

Lock 阶段 §8 写明：等用户本机复产一次"知识图谱是什么"并抓浏览器 DevTools Network → `/api/qa/ask` 或 `/api/agent/dispatch` 的 **EventStream** 标签前 30 行，看：

- 如果 `content` 事件只有一次 `{text:"知识"}` 就 `done` → **LLM 真的返短回答**，根因是 prompt 被数据毒化 + system 过严（独立 change：prompt 分支策略）
- 如果 `content` 有多条但前端只渲染前两字 → 前端 state 管理 bug
- 如果到处是 `rag_step` 但没 `content` 也没 `error` → SSE 中断或 dispatchHandler 的 catch 吞异常（D3 未覆盖，需要 chatStream 增加中断点重试）

本 change D3 只做"完全空流"这种最直观的守护；其它情形独立立项。
