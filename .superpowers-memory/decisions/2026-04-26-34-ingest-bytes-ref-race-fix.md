# ADR-34 · 修复 ingest race + AGE Cypher 语法 + xlsx 空 paragraph 兜底

- 日期：2026-04-26
- 状态：**Accepted**
- 工作流：Hot-fix（线上 bug 立即修，附 ADR）

## 背景

用户上传文档时观察到三个并存的问题：

1. **MD 上传随机失败**：`bytes_ref missing — enqueue 阶段写入失败或 tmp 已被清理`
2. **xlsx 详情显示 "0 / 共 2 段"**：能识别两个 sheet（heading chunks），但没有可向量化的 paragraph chunks
3. **qa-service 日志反复 spam** `[graphDb] runCypher failed: syntax error at or near "|"` —— ADR-33 新加的 `/api/ontology/path` 路由的副作用

## 根因

### 1. ingest race condition

`enqueueIngestJob` 不是原子操作：

```
T1: dbInsertJob → INSERT row(status='queued', bytes_ref=NULL)   ← 行立即可见
T2: fs.writeFile(tmp, bytes)                                     ← 慢操作
T3: UPDATE ingest_job SET bytes_ref = tmp_path                   ← 才补上 ref
```

ingestWorker 每 500ms 轮询 `WHERE status='queued'`，**完全可能在 T2 / T3 之间把这行 claim 走**。`hydrateInput` 看到 `bytes_ref=NULL` 抛错，job 标失败。

PDF / MD 都有此 race，纯运气决定哪个 trigger。MD 短文件理论上反而更容易 race（INSERT 后 writeFile 极快返回，但 worker 轮询恰好命中也是可能的）。

### 2. AGE 1.6 Cypher 不支持关系类型 alternation 语法

ADR-33 新加的 `getOneHopAssetNeighbors` 用了：

```cypher
MATCH (a:Asset {id: $aid})-[r:CITED|CO_CITED]-(b:Asset)
```

AGE 1.6.0 的 Cypher 解析器不接受 `|` alternation，抛 `syntax error at or near "|"`。

### 3. xlsx 行级 AST 空时只有 heading chunks

部分 xlsx 文件（特别是含合并单元格 / 复杂格式）经 officeparser 解析后 `sheet.children` 为空数组（headers 被识别成 sheet metadata，但 row data 没展开）。当前代码只在**整个 AST 没有 sheet 时**才回退 `toText()`；AST 有 sheet 但行为空时直接跳过，最终 chunks=[heading×N, paragraph×0]。L3=0 → 无可向量化 → 详情面板"显示前 0 / 共 N 段"。

## 修复

### Fix 1a · worker claim 加 bytes_ref 检查（防御）

`apps/qa-service/src/services/ingestWorker.ts:claimOne`：

```sql
WHERE status = 'queued'
  AND (kind = 'abstract' OR bytes_ref IS NOT NULL)
```

`abstract` 类型例外（lazy 回填走 input_payload，不需要 bytes）。其他 kind 必须 bytes_ref 已 ready 才能被 claim。这是**防御性修复**——防止 worker 拿到不完整的 row。

### Fix 1b · enqueueIngestJob 改 UPDATE → UPSERT（治本）

`apps/qa-service/src/services/ingestPipeline/index.ts:enqueueIngestJob`：

**真正根因**：`createJob` 内部 `dbInsertJob` 是 fire-and-forget（`pool.query(...).catch(...)`，不 await），返回时 INSERT 还在飞行中。`enqueueIngestJob` step 3 立刻发的 UPDATE 走另一个连接，**两条 SQL 异步并发**——UPDATE 可能在 INSERT 之前到达 DB，`WHERE id=$1` 命中 0 行，`rowCount=0` 但**没异常**，函数返回成功。INSERT 后到完成，row 就此 `bytes_ref=NULL` 永久 stuck（手动数据：上传 3 分钟仍 has_ref=f）。

修法：把 UPDATE 改成 `INSERT ... ON CONFLICT (id) DO UPDATE` 包含完整字段：

```sql
INSERT INTO ingest_job (id, kind, source_id, name, input_payload, status, phase, ..., bytes_ref)
VALUES ($1, ..., $7)
ON CONFLICT (id) DO UPDATE SET
  bytes_ref     = EXCLUDED.bytes_ref,
  input_payload = ingest_job.input_payload || EXCLUDED.input_payload,
  updated_at    = NOW()
```

不论 createJob 的 INSERT 与本 UPSERT 谁先到，最终 row 必含 `bytes_ref`：
- 我先到 → 完整 INSERT，createJob 后到走自己的 `ON CONFLICT DO NOTHING`
- createJob 先到 → 我走 ON CONFLICT branch，覆盖 bytes_ref + 合并 payload

**为什么不 await dbInsertJob**：dbInsertJob 接口被很多同步路径用（routes/ingest.ts 分支 3 的 createJob + runIngestAndTrack），改成 async 影响面大；UPSERT 是局部 minimal 改动。

### Fix 2 · AGE Cypher 关系类型 alternation 改成两次查询

`apps/qa-service/src/routes/ontology.ts:getOneHopAssetNeighbors`：从一次 query alternation 改成 for-loop 两次单类型 query，应用层合并结果。性能损失忽略（一跳 BFS 数量级）。

### Fix 3 · xlsx 空行 AST 兜底

`apps/qa-service/src/services/ingestPipeline/extractors/officeFamily.ts`：

**v1（错的）**：扩展为"AST 有 sheet 但 paragraph chunks=0 也回退到 toText()"。但 toText() 用的是同一份 officeparser 解析结果，**对此类文件也是空**——治标不治本。

**v3（正确）**：引入 SheetJS（`xlsx` 包，从 SheetJS 官方 CDN 安装 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`）作 secondary fallback。officeparser 0 paragraph 时调 SheetJS 重解析；SheetJS 也空才回到 toText() 最后保底。

实测对照（GM_尾门工程最佳实践_评测集.xlsx，71 行 9 列）：

| 解析器 | sheet count | rows |
|---|---|---|
| officeparser AST | 2 | 0（不展开 children） |
| officeparser toText | 2 | 0（同源） |
| SheetJS (xlsx) | 2 | 71 ✅ |
| openpyxl（参考） | 2 | 71 ✅ |

兜底链：
```
officeparser AST 有 paragraph → 用它
否则 SheetJS 解析有 rows → 重置 chunks 用 SheetJS
否则 toText() 最后保底
```

**为什么不直接换主路径为 SheetJS**：officeparser 在大多数英文 / 简单 xlsx 上表现稳定；保留它做主路径不破坏现有 ADR-28 的修复。SheetJS 仅在 officeparser 失败时启用。

## 决策记录

- **D1 worker 端 claim 过滤而非 enqueue 事务化**：影响面最小，不改外部接口；与 ingest-async-pipeline ADR-40 兼容。
- **D2 AGE Cypher 用 for-loop 而非升级 AGE 版本**：升级 AGE 1.6 → 1.7 风险大，且当前部署目标是 1.6 LTS。
- **D3 xlsx 兜底叠加而非替换**：保留 AST 提取的 heading chunks（带 sheetName 上下文），在它后面追加 toText() 提取的 paragraphs，互相补强。
- **D4 不改 jobRegistry / dbInsertJob**：保持 createJob 的"INSERT 后行立即可见"语义不变；这个语义被其他调用方（同步 ingest 路径）依赖。

## 测试 / 验收

- `tsc --noEmit` 双 0
- 手动验证：
  - 重启 qa-service 后随机批量上传 10 份 MD（不同大小）→ 0 失败
  - 重传 GM_尾门工程最佳实践_评测集.xlsx → ingest_done 日志 `chunks.l3 > 0`
  - `/api/ontology/path` 调一次 → qa-service.log 无 `syntax error at or near "|"` warn

## 数据清理（需用户在本机跑）

之前 stuck 的 `status='queued' AND bytes_ref IS NULL` 行需要批量标失败，否则 worker 修复后还是会反复 claim 它们：

```sql
UPDATE ingest_job
   SET status = 'failed',
       error  = 'cleaned up by ADR-34 (bytes_ref never set, race victim)',
       finished_at = NOW()
 WHERE status = 'queued'
   AND bytes_ref IS NULL
   AND kind <> 'abstract';
```

## 文件清单

修改：
- `apps/qa-service/src/services/ingestWorker.ts` · claim 加 bytes_ref 过滤（Fix 1a）
- `apps/qa-service/src/services/ingestPipeline/index.ts` · enqueueIngestJob UPDATE → UPSERT（Fix 1b · 治本）
- `apps/qa-service/src/routes/ontology.ts` · for-loop 两次单类型 Cypher（Fix 2）
- `apps/qa-service/src/services/ingestPipeline/extractors/officeFamily.ts` · 加 parseXlsxWithSheetJS + 两路径都 SheetJS 兜底（Fix 3 v3）
- `apps/qa-service/package.json` · 新增依赖 `xlsx`（SheetJS CDN 装）

## 与既有 ADR 的关系

- ADR-40（ingest-async-pipeline）：本 ADR 是其一个补丁，不动 enqueue 接口；后续如果引入跨节点 worker，需要再考虑事务化
- ADR-32（ingest-l0-abstract）：'abstract' kind 在新过滤里被显式 allow-list，lazy backfill 不受影响
- ADR-33（mcp ontology routes fill）：本 ADR 修复了 ADR-33 引入的 cypher syntax 副作用
- ADR-28（xlsx-ingest-fix）：本 ADR 是 ADR-28 系列的延续——AST 行空场景之前未覆盖
