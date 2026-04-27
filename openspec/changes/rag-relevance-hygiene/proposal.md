# Proposal: rag-relevance-hygiene

## 背景

2026/4/23 测试报告 BUG-01："知识图谱是什么"回答只输出"知识"两字；trace 里 reranker 前 5 分数全 `0.00`，引用文档置信度全 `0%`。

Explore 阶段（`docs/superpowers/specs/rag-answer-truncation/design.md`）+ 用户本机 curl SiliconFlow rerank API 得到决定性信号：

```
query="知识图谱是什么", documents=[知识图谱定义, 苹果, PostgreSQL]
→ results=[
    { index:0, relevance_score: 0.9996 },   ← 相关文档
    { index:2, relevance_score: 0.0490 },
    { index:1, relevance_score: 0.0000166 } ← 无关文档
  ]
```

**根因不是 reranker 坏**，是三层问题叠加：

1. **UI 分数显示精度不足** · `ragPipeline.ts:189` 用 `score.toFixed(2)` → 任何 < 0.005 的分数都四舍五入成 `"0.00"`；文档置信度用 `%` 整数也同样吃精度 → 用户看到"前 5 分数 0.00 / 0.00 / 0.00 / 0.00 / 0.00" **不代表 reranker 返 0**，是显示层掩盖了真实量级
2. **数据源污染** · 库里充斥 OCR 碎片（批 D · BUG-14 同源）+ JSON error body（批 D · BUG-02 同源）被当正文入库；reranker 对这些乱码客观打 ~1e-5 级分数（量级对，就是"都不相关"），toFixed 后看起来就是 0.00。reranker 的分数"0.00"本质是"库里没能匹配这个问题的内容"的正确反馈
3. **LLM 回答截断**（H3 假设，未完全坐实）· 答复"知识"两字就停的现象用"数据污染"部分解释（LLM 被无关 context 毒化），但两字戛然而止不寻常。**等用户本机 Network EventStream 信号**区分"LLM 真吐两字"vs"SSE 流中断"

## 范围

### IN（5 处改动）

**A · UI 分数显示真实量级** (`ragPipeline.ts` rag_step emit + 前端引用文档置信度)
- 后端 emit 的 `rag_step` label 里把 `score.toFixed(2)` 改成分桶展示：
  - `score ≥ 0.5` → `toFixed(2)`（高相关，能看到正常两位小数）
  - `0.01 ≤ score < 0.5` → `score.toFixed(3)`（中相关，三位小数看清楚）
  - `score < 0.01` → `score.toExponential(2)`（科学记数法，`1.66e-5`，一眼分辨"极低"）
- 前端引用文档置信度 pill：同样分桶显示（`高 / 中 / 低` + 原始分数 tooltip），不再吃精度

**B · 相关性阈值 WARN**
- rerank 后如果 top-1 分数 < **0.1**（中等相关的合理下界），`emit({ type: 'rag_step', icon: '⚠️', label: '检索结果相关性极低（top-1=<x>）。可能原因：该问题库里无相关文档 / 文档质量差 / 问法需调整。' })`
- 不阻断流程，只是把"用户本来看不到的事实"显式化

**C · ingest 层过滤脏 chunk**
- `services/ingestPipeline/pipeline.ts` 写 `metadata_field`（chunk 表，`chunk_level=3` 是 embed 粒度）前加 gate：
  - `content.length < MIN_CHUNK_CHARS`（20）直接丢
  - 复用批 D 的 `looksLikeOcrFragment`（从 `services/tagExtract.ts` 抽到共享 util）扩展到 chunk 粒度：emoji / 裸引号 / 平均 token 长度 < 2 / 单字符 token ≥ 3 个 → 丢
  - 识别 JSON error blob（顶层带 `type:"error"` 或 `error:{...}` / `File not found in container`）→ 丢
  - 日志统计本次入库被过滤掉多少 chunk

**D · 一次性清库脚本** (`scripts/cleanup-bad-chunks.sh`，配合 `.sql` 子文件)
- 扫 `metadata_field`（仅 `chunk_level = 3`）：用 SQL + 服务端 regex 列出满足上述三条的行（默认 **dry-run 只 SELECT**，需要 `--confirm` 才 DELETE）
- 输出报告：每种类型命中多少行、涉及多少 asset / source
- 删除后级联：同步从 `metadata_asset.content` 里重新生成 chunk 不在本脚本范围；受影响 asset 需手动重跑 ingest 或由后续 re-embed job 处理

**D3 · chatStream 空流守护** (`services/llm.ts`)
- `chatStream` yield 次数 == 0 时 `throw new Error('LLM stream returned no content chunks')`
- 上层 ragPipeline → dispatchHandler catch → emit `error` 事件；前端看到显式错误不再"静默停在两字"
- 同时 `reader.read()` 异常也被捕获转成 error event

### OUT（明确推到 V2.x 或另立）

- **H3 根因定位**：等 user EventStream 信号；若 LLM 真的只吐两字就停，需要 prompt 改造（独立 change），不在本轮
- **ingest 层全面清洗 pipeline**：C 做的是 chunk 粒度防御；更上游的 PDF OCR 质量判断、HTML 清洗加强 → 独立 perf + quality change
- **重 embed 存量 asset 的自动化**：D 只给 SQL 供你本机跑，不做 batch re-embed job

## 决策记录

- **D-001** · UI 分数显示分三档（≥0.5 / 0.01-0.5 / <0.01），科学记数法只用在超低区；统一给前端 tooltip 附真实分数。理由：既保留"正常场景看 2 位小数"的直觉，又让"极低分"不被精度吃掉
- **D-002** · B 的阈值定 **0.1**，来源于 SiliconFlow bge-reranker-v2-m3 的经验值：**相关**样本 top-1 应 ≥ 0.3-0.5；0.1 以下基本是"量级对不上了"。不是硬拒，只是 WARN
- **D-003** · C 和批 D · BUG-14 用**同一个 `looksLikeOcrFragment`**（抽成公共 util），避免两层检测分叉；tagExtract 保留原有调用路径
- **D-004** · D 的 SQL 脚本**默认 SELECT dry-run**，加 `--confirm` 才 DELETE；范围：`metadata_asset_chunk` + 同步级联的 embedding 表（DELETE 时）
- **D-005** · D3 的守护**空流直接 throw**，不自动重试。LLM 流空属于系统级故障，让前端看到比静默截断好；重试策略留给后续 observability/retry 独立 change

## 验证

- `tsc --noEmit` 双 0（qa-service + web）
- `pnpm -r test` 新增单测：
  - `ragPipeline` rerank label 三档分桶（spec.acl-v2 测试用例模式）
  - `reranker` 防御：字段缺失 / 分数全 0 场景
  - `ingestPipeline` chunk gate：短 chunk / OCR / JSON error 各一条
  - `chatStream` 空流 throw
- 本机冒烟：
  - 重问"知识图谱是什么"：trace 显示真实分数（科学记数或三位小数）+ 阈值 WARN；不再全 "0.00"
  - 跑 `scripts/cleanup-bad-chunks.sql --dry-run`：输出被污染 chunk 的统计
  - 跑 `scripts/cleanup-bad-chunks.sql --confirm`：实际 DELETE 并打印报告
  - 入库一个含 OCR 碎片的 PDF：查 DB 应该看到碎片 chunk 没被写入（C 生效）
