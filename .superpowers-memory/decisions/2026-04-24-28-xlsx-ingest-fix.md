# ADR-28 · 2026-04-24 · xlsx Ingest 两处根治

> 工作流：C（superpowers-feature · bug 批清）
> 触发：用户上报 Excel 文件上传后列表显示 `0 切片 · 0 图` + 文件名乱码
> 影响文件：
>   - `apps/qa-service/src/services/ingestPipeline/extractors/officeFamily.ts`（xlsx 重写）
>   - `apps/qa-service/src/services/fileName.ts`（新增）
>   - `apps/qa-service/src/routes/ingest.ts`（2 处 originalname 替换）
>   - `apps/qa-service/src/routes/knowledgeDocs.ts`（1 处 originalname 替换）
>   - `apps/qa-service/src/__tests__/fileName.test.ts`（新增）
>   - `apps/qa-service/src/__tests__/xlsxExtractor.test.ts`（新增）

## 背景

用户上传 `GM_尾门总成工程...xlsx` 后：
- 列表显示文件名乱码（`å°¾é ¨à·¥ç¨...`）
- Asset 规模显示 `0 切片 · 0 图`
- job 状态却是 "正常" —— 用户看不到任何报错

根因调查发现这是**两个独立 bug 叠加**：

### D-009 · 文件名 UTF-8-as-Latin-1 mojibake

`multer` 默认用 latin1 解码 multipart Content-Disposition 的 `filename`。浏览器上传中文文件名时发的是 UTF-8 字节，`file.originalname` 里拿到的是 UTF-8 字节被当成 latin1 字符串的 mojibake（每个 UTF-8 字节对应一个 U+0080~U+00FF 字符）。

### D-010 · xlsx extractor 0 chunks

原 `makeOfficeExtractor('xlsx')` 调 `officeparser.parseOffice().toText()` 后按 `\n{2,}` 切。问题：
- officeparser 的 xlsx `toText()` 输出每行单换行，不会出现连续换行
- 整个 Excel 糊成一整段 paragraph chunk → 长度容易超限 / 被 `textHygiene.isBadChunk` 过滤
- 即使侥幸入库，1 条 paragraph 无法支撑行级检索（Excel 问答刚需）
- `officeparser.parseOffice` 抛异常时 catch 只 push 进 warnings，不往上抛 → **job 状态看起来正常但 0 chunks**

pptx 不受影响是因为 officeparser 在页/节之间吐空行，`\n{2,}` 分隔稳定。

## 决策

### D-009 修复 · `decodeUploadedFilename(name)`

新建 `services/fileName.ts`：
- 如果 name 没有 `U+0080~U+00FF` 字符 → 纯 ASCII，原样返回
- 否则 `Buffer.from(name, 'latin1').toString('utf8')` 尝试解码
- 若解码结果含 `U+FFFD`（说明原值是合法 latin1，不是 mojibake）→ 回退原值
- try/catch 兜底

四个 multer 调用点替换：
- `routes/ingest.ts` `/extract-text` (L206 行附近)
- `routes/ingest.ts` `/upload-full` createJob.name + runIngestAndTrack (L346/L357)
- `routes/knowledgeDocs.ts` `/ingest` ingestDocument.name (L65)

### D-010 修复 · xlsx 单独走 AST

`officeFamily.ts` 拆分 `pptxExtractor` / `xlsxExtractor`：

**pptxExtractor**：维持原逻辑（toText + `\n{2,}` split）。

**xlsxExtractor** 三级路径：
- **路径 A**：`ast.content` 有 sheet 节点 → 每个 sheet 写 1 条 heading chunk（`Sheet: XXX`），每行拼 ` | ` 写 1 条 paragraph chunk（前缀 `[sheetName]`）
- **路径 B**：AST 空 → 降级到 `toText()` 按单换行 split，warnings 记录 `'xlsx AST empty'`
- **路径 C**：仍 0 chunks → **throw Error**，让 `ingestPipeline/pipeline.ts` 上层 catch 把 job 状态走 failed，不再静默"完成"

### 为什么不引入 SheetJS（xlsx npm 包）

初版方案考虑直接引 `xlsx`（SheetJS）做更精细的 sheet_to_csv。否决原因：
- `officeparser` 已是现有依赖，AST 已有 sheet/row/cell 结构
- 引新依赖要改 `package.json`、重跑 `pnpm install`、测量 bundle 影响
- D-010 当前方案已满足用户场景：行级可检索 + sheet 名前缀 + 失败显式抛

后续若要支持公式、合并单元格、富文本格式等，可再开 ADR 引 SheetJS。

## 验证闸门

| 闸门 | 结果 |
|---|---|
| qa-service `tsc --noEmit` | ✅ EXIT=0（本次无新类型错误） |
| `fileName.test.ts` | 4 个 case：ASCII / mojibake 还原 / 合法 latin1 保留 / 边界值 |
| `xlsxExtractor.test.ts` | 5 个 case：正常 AST / 多 sheet / AST 空降级 / 0 chunks 抛错 / parser 本身抛错 |
| 浏览器手测（用户本机） | ⏸ 重新上传原 xlsx，确认：文件名正确中文 + chunks > 0 |

## 第二轮迭代 · BUG-xlsx-02 · 短行被 textHygiene 全过滤

首轮发布后用户上传评测集 xlsx，前端显示「切片 2」，其中 2 条都是 Sheet heading（L1 不过 gate），所有行级 paragraph 被 `textHygiene.isBadChunk(MIN_CHUNK_CHARS=20)` 判成 `too_short`。

### 根因

我首轮的 paragraph 文本 `[评测集] 日期 | 销售额 | 地区` ~18 字，评测集类表每行普遍 10~20 字；加上 `[sheet] ` 前缀也普遍 < 20 字，全被 chunk gate 拦截。

### D-011 修复 · 行聚合 + 扩展前缀

- **聚合策略**：每 sheet 内把多行拼成单个 paragraph chunk，软上限 `XLSX_CHUNK_TARGET_CHARS=500`。超过才 flush 开新块
- **块前缀**：从 `[sheetName] `（单行）改成 `Sheet: ${sheetName}\n`（多行块头），同时让每块首行即语义自洽
- **行内格式不丢**：聚合用 `\n` 分隔，保留原行结构——retrieval 命中某块后，LLM 能看到哪行是哪行
- **边界**：若某 sheet 内聚合后仍 < 20 字（极小表），交给 chunk gate 过滤，不强行放行
- **大表自动切块**：40 行 × 30 字的表自动切成 2~3 块，每块 ~500 字

### 验证（probe 脚本）

30 行评测集 xlsx → 1 heading + 2 paragraph chunks（508 字 / 444 字）；每块都 >> 20 字，全部通过 chunk gate。相比修前（0 paragraph）是质变。

## 历史脏数据

已上传但 0 chunks 的 xlsx asset 不会自动修复。用户操作：
1. `/ingest` 页面找到这些 asset（规模列 `0 切片 · 0 图`）
2. 删除后重新上传，会走新管线

或者跑 `scripts/cleanup-bad-chunks-ocr.mjs`（dry-run 模式先看影响面）。

## 相关

- 上游：`integrations.md` § Ingest Pipeline 统一入口
- 工作流指引：`docs/workflows/README.md`（工作流 C）
- 下一步可开：`xlsx-sheetjs-upgrade`（支持合并单元格 + 公式 + 富文本），工作流 B
