# Spec: Ingest Pipeline 统一

## ingestDocument(input) — 入口契约

**Scenario: PDF 走 pdf extractor，落 metadata_asset / metadata_field / metadata_asset_image**
- Given input.name = 'demo.pdf'，PDF 含 3 页/2 张图
- When ingestDocument(input)
- Then `IngestOutput.assetId` > 0
- And `IngestOutput.extractorId === 'pdf'`
- And `metadata_field` 至少有一条 kind='heading' 的行 + 若干 kind='paragraph'/'table'/'image_caption'
- And 每行 page 列非 NULL

**Scenario: docx 走 docx extractor**
- Given input.name = 'spec.docx'
- Then `IngestOutput.extractorId === 'docx'`
- And metadata_field 至少有一条 kind='paragraph'

**Scenario: 未知扩展兜底 plaintext**
- Given input.name = 'spec.weird'
- Then `IngestOutput.extractorId === 'plaintext'`
- And warnings 含 'unknown extension, fallback to plaintext'

**Scenario: opts.skipTags 跳过 tags 抽取**
- Given input.opts.skipTags = true
- Then `IngestOutput.tags === []`
- And extractTags 未被调用

---

## router.routeExtractor

**Scenario: 已知扩展精确路由**
- routeExtractor('.pdf') → pdfExtractor
- routeExtractor('.PDF') → pdfExtractor （大小写无关）
- routeExtractor('.docx') → docxExtractor
- routeExtractor('.png') → imageExtractor

**Scenario: 未知扩展兜底**
- routeExtractor('.xyz') → plaintextExtractor

---

## pdf extractor

**Scenario: ODL 成功**
- Given pdfPipeline 返结构化 chunks + images + captions
- Then ExtractResult.chunks 包含 heading/paragraph/table/image_caption
- And ExtractResult.images 含 caption（PDF VLM 在 pipeline 内已算）
- And extractorId === 'pdf'

**Scenario: ODL 不可用降级**
- Given OdlNotAvailableError
- Then 使用 PDFParse v2 平文本作为单一 chunk(kind='paragraph')
- And extractorId === 'fallback'
- And warnings 含 ODL 失败原因

---

## docx extractor

**Scenario: 抽取正文段落**
- Given mammoth 返 'p1\n\np2\n\np3'
- Then chunks 长度 3，全部 kind='paragraph'

---

## pipeline.ts —— 后处理

**Scenario: heading → chunk_level=1（不 embed），其它 → chunk_level=3（embed）**
- Given ExtractResult chunks: [heading, paragraph, paragraph]
- Then metadata_field 写 3 行
- And 1 行 chunk_level=1 embedding=NULL，2 行 chunk_level=3 embedding 非 NULL

**Scenario: 写入 kind / page / bbox / heading_path**
- Given chunk{kind:'paragraph', page:5, bbox:[10,20,30,40], headingPath:'1/1.2'}
- Then 对应 metadata_field 行 kind='paragraph', page=5, bbox=JSON, heading_path='1/1.2'

**Scenario: image_caption chunk 的 image_id 关联**
- Given image 已经 persistImages 拿到 imageId=99
- And chunk{kind:'image_caption', imageRefIndex:{page:1,index:1}}
- Then metadata_field 行 image_id=99

**Scenario: 空 fullText 时 tags 跳过**
- Given ExtractResult.fullText = ''
- Then extractTags 不调用；tags=[]

---

## ACL 接入

**Scenario: 未登录拒绝（生产）**
- Given AUTH_HS256_SECRET 已配且无 token
- When POST /api/knowledge/ingest
- Then 401

**Scenario: 角色无 WRITE 权限拒绝**
- Given principal roles=['viewer']，无对应 source_id 的 WRITE 规则
- When POST /api/knowledge/ingest body.source_id=1
- Then 403 reason='no matching rule'

**Scenario: DEV BYPASS 放行**
- Given AUTH_* 全空且 NODE_ENV !== production
- Then 等价 admin；request 通过

---

## 路由迁移

**Scenario: /api/knowledge/ingest 走统一 pipeline**
- Given 上传 PDF
- Then 内部调 ingestDocument 一次
- And 旧手写的 chunkDocument / persistImages / captionImages 路径不再被这个 route 直接调

**Scenario: /api/ingest/scan-folder 每文件走 ingestDocument**
- Given 文件夹含 a.pdf b.docx c.txt
- Then 三次 ingestDocument 调用，每次 SSE event{type:'file', status:'done'} emit assetId

**Scenario: BookStack sync 用 ingestDocument**
- Given indexBookstackPage(pageId)
- Then 取 HTML / PDF 内容 → ingestDocument({buffer, name=`bookstack-page-${pageId}.html`, sourceId=<bookstack source>})

---

## 响应向后兼容

**Scenario: response 字段不破坏旧客户端**
- Given 老前端期望 {assetId, chunks:{l1,l2,l3}, tags, images, structuredChunks, warnings?}
- Then IngestOutput 仍含这些字段（l2 在新路径恒 0；warnings 在无警告时不出现）
- And 新增 extractorId 是新增字段，老客户端忽略
