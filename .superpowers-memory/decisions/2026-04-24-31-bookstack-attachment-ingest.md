# ADR-31 · 2026-04-24 · BookStack 页面附件索引

> 工作流：B（superpowers-openspec-execution · 补链路缺口）
> 触发：用户把 xlsx 上传到 BookStack 页面作为附件，sync 过来显示「切片 2」—— 全是 Sheet heading 空壳。
> 影响文件：
>   - `apps/qa-service/src/services/bookstack.ts`（新增 `listPageAttachments` / `getAttachmentContent`）
>   - `apps/qa-service/src/services/indexBookstackPage.ts`（sync 时附带处理附件）
>   - `apps/qa-service/src/routes/assetDirectory.ts`（新增 `POST /reindex-page`）

## 背景 · 真实根因

前几轮分析把责任推给 `xlsxExtractor` 没出 paragraph chunk，其实 **xlsxExtractor 根本没被调用**。BookStack sync 链路只读页面 HTML body：

```
BookStack /api/pages/{id}          → page.html
stripHtml(page.html)               → text
ingestDocument({                   ← 名字是 bookstack-page-{id}.txt
  buffer: Buffer.from(text),
  name: `bookstack-page-${pageId}.txt`,
  ...
})
router.ts::routeExtractor('.txt')  → plaintextExtractor（不是 xlsxExtractor！）
```

附件（page attachment）作为 BookStack 实体文件独立存放，**完全没被下载过**。用户看到的"Sheet: 评测集 / Sheet: 统计概览"两条 chunk，来自 BookStack 页面 HTML 的 shell 文本（表头可能被手动粘贴到 page 正文里），而不是 xlsx 文件的真实内容。

## 决策

### D-001 · 新增附件 API（bookstack.ts）

```ts
listPageAttachments(pageId) → BookstackAttachment[]       // 列页面所有附件（filter[uploaded_to]）
getAttachmentContent(attId) → { name, buffer, extension } // 下载实体（base64→Buffer）
```

外部链接（`external: true`）跳过，只处理实体上传附件。

### D-002 · `indexBookstackPage` 三段式

原来只有"老路径 MySQL + 新路径 pgvector 页面正文"两段。加第三段：

1. 老路径：MySQL `knowledge_chunks`（页面 HTML 文本，保留向后兼容）
2. 新路径 A：pgvector asset（页面正文，name `bookstack-page-{id}.txt`）
3. **新路径 B · 附件（本 ADR）**：对每个支持扩展名的附件
   - 下载 → `ingestDocument({ buffer, name: 真实文件名, sourceId })`
   - 路由按真实扩展名走（xlsx → xlsxExtractor，pdf → pdfPipeline v2，docx → docxExtractor）
   - 幂等：先 `DELETE FROM metadata_asset WHERE external_path = 'bookstack:attachment:{id}'`
   - 成功后 `UPDATE external_path + external_id`，下次 sync 可精准识别

### D-003 · 过滤规则

- `att.external === true`：跳过（URL 链接非实体）
- `isKnownExt(att.name) === false`：跳过（避免把任意二进制丢给 plaintext 兜底）
- 下载失败 / ingest 失败：单条 WARN，不阻塞其它附件 + 不阻塞主页面索引

### D-004 · 新增 `POST /api/asset-directory/reindex-page`

一个轻量端点，给用户或调度器直接重跑单页索引（含附件）用：
- 不走 `sync-pages`（后者只刷 asset_item 元数据）
- 不走 `register-bookstack-page`（后者会重写 asset_item name/summary）
- 参数只有 `{ pageId }`；返 `indexBookstackPage` 的完整统计（含 `attachments: { total, ingested, skipped, failed }`）

`requireAssetWriter` 门槛（与 sync-pages 一致）。

## 为什么不改 `sync-pages` 自动全量 reindex

- `sync-pages` 跑 100+ 页会很慢（每页可能多个附件）；
- 用户需要的是"某个页面出问题 → 重跑这个页"的低成本通路；
- 全量 reindex 可以后续按日期 / 状态筛选再加。

## 幂等设计

| 场景 | 机制 |
|---|---|
| 同一附件多次 sync | `external_path = 'bookstack:attachment:{id}'` 先 DELETE 再 INSERT；FK CASCADE 清 chunks / images |
| 附件被 BookStack 删除 | V1 不自动清理（孤儿 asset 残留），可后续加「本地 assets 反查 BookStack 还存不存在」的清理 |
| 附件被替换（同 attId 新内容） | 下次 sync 会 DELETE + INSERT，旧 chunks 不留 |

## 验证闸门

| 闸门 | 结果 |
|---|---|
| qa-service `tsc --noEmit` | ✅ EXIT=0 |
| 单测 | ⏸ 本轮未写（需要 mock BookStack API，E2E 场景强依赖真实服务） |
| 用户本机验证 | ⏸ 下面步骤 |

## 用户本机验证步骤

### 前置

**必须先重启 qa-service**，否则新代码不生效。

```bash
pnpm dev:restart
tail -f .dev-logs/qa-service.log
```

### 路径一：复用已有 asset，重跑索引

```bash
# 1. 找到问题页面的 pageId（在 BookStack 里看 URL 里的 page id，或通过 /api/pages 列表）
# 2. 用 curl 触发 reindex
curl -X POST http://localhost:3001/api/asset-directory/reindex-page \
  -H 'Content-Type: application/json' \
  -d '{"pageId": 42}'    # 替换成真实 pageId
```

期望 response：
```json
{
  "ok": true,
  "pageId": 42,
  "chunks": <page正文chunks数>,
  "pgAssetId": <页面 asset id>,
  "extractorId": "plaintext",
  "attachments": {
    "total": 1,       // BookStack 上这个页面有 1 个附件
    "ingested": 1,    // 成功 ingest 1 个
    "skipped": 0,
    "failed": 0
  }
}
```

### 路径二：删掉老 asset + 重新上传（更简单）

用 ADR-30 新加的 🗑 按钮删除 "切片 2" 的旧 asset，然后**在 `/ingest` 页面直接上传 xlsx**（不走 BookStack）。这样就走 `/api/ingest/upload-full` → `xlsxExtractor` 直接路径。

### 判断链路

之后去资产详情看：
- 文件名是 `GM_尾门....xlsx`（真实文件名）→ 走的是路径二 / 或者附件路径（正确）
- 文件名是 `bookstack-page-XXX.txt` → 只处理了页面正文，附件没进来

新 asset 的 `external_path` 字段应该是 `bookstack:attachment:{id}`，可以在 DB 验证：
```sql
SELECT id, name, external_path FROM metadata_asset ORDER BY id DESC LIMIT 10;
```

## 相关

- 上游：ADR-28（xlsx ingest 根治 + 500 字聚合）—— 附件链路打通后这个才真正生效
- 上游：ADR-30（资产删除）—— 重试链路的前置
- 后续可开：`bookstack-attachment-cleanup`（孤儿 asset 扫描 + 清理）
