# Spec: PDF Pipeline v2

## extractPdfStructured(buffer, name, opts)

**Scenario: ODL 调用成功，返回结构化 chunks**
- Given 输入 PDF 包含 3 页：页 1=标题+目录、页 2=带 1 张图+少量文字、页 3=表格
- When 调用 `extractPdfStructured(buffer, 'demo.pdf')`
- Then `result.chunks` 包含 heading（page=1）、paragraph（page=1）、image_caption（page=2，若 VLM 开）、table chunk（page=3）
- And `result.images` 长度 ≥ 1
- And `result.fellBackToOfficeParser === false`

**Scenario: ODL 未安装 / Java 缺失 → 降级**
- Given `@opendataloader/pdf` import 抛 ERR_MODULE_NOT_FOUND
- When 调用 extractPdfStructured
- Then 抛 OdlNotAvailableError
- And 调用方 catch 后切到 officeparser 旧路径

**Scenario: ODL convert 抛运行时异常 → 降级**
- Given convert 内部抛 Error('JVM crashed')
- Then 同上降级；warnings 含 'odl convert failed: JVM crashed'

**Scenario: 临时文件清理**
- Given 任意成功 / 失败路径
- Then `/tmp/odl-{uuid}.pdf` 被删除（finally）

---

## odlParse — JSON → PdfChunk[]

**Scenario: heading 元素映射**
- Given JSON 含 `{ type: 'heading', level: 2, page: 1, text: 'Strut Size', bbox: [..] }`
- Then 输出 `{ kind: 'heading', headingLevel: 2, page: 1, text: 'Strut Size', bbox: [..] }`

**Scenario: paragraph 元素映射**
- Given `{ type: 'paragraph', page: 2, text: 'For liftgates, 10x22 ...' }`
- Then 输出 `{ kind: 'paragraph', page: 2, text: '...' }`

**Scenario: table 元素映射为 markdown table**
- Given `{ type: 'table', page: 3, cells: [[a,b],[c,d]] }`
- Then 输出 `{ kind: 'table', page: 3, text: '| a | b |\n| --- | --- |\n| c | d |' }`

**Scenario: image 元素仅落 PdfImage，不直接进 chunk（caption 由 VLM 单独生成）**
- Given `{ type: 'image', page: 2, src: 'extracted/p2-img1.png', bbox: [..] }`
- Then `images` 数组追加一项；`chunks` 不直接追加 image_caption

**Scenario: 跳过页眉页脚**
- Given paragraph 含 `text: 'GM Confidential'` 或纯页码（如 `'3'`）
- Then 该 chunk 被过滤

---

## imageStore

**Scenario: 持久化路径**
- Given assetId=42, image.page=2, image.index=1, ext=png
- When `persistImages(assetId, images)`
- Then 文件写到 `infra/asset_images/42/2-1.png`
- And `metadata_asset_image` 表插入一行 `{asset_id:42, page:2, image_index:1, file_path: 'infra/asset_images/42/2-1.png'}`

**Scenario: UNIQUE 冲突时 ON CONFLICT 跳过**
- Given 同 asset/page/idx 已存在
- Then 不抛错，二次插入返回已存在 row id

**Scenario: 删除 asset 级联清理**
- Given DB 删除 metadata_asset → ON DELETE CASCADE 清 metadata_asset_image
- And 文件清理由后续 housekeeping 任务处理（本 change 不实现物理删除）

---

## vlmCaption

**Scenario: image-heavy 页触发**
- Given 页面文字 < 300 字 或 图片 ≥ 3 张
- Then 该页所有图都送 VLM
- And caption 写到 metadata_asset_image.caption
- And 同时输出 image_caption chunk

**Scenario: 非 image-heavy 页跳过**
- Given 页面文字 1000 字 + 1 张图
- Then 不调 VLM；caption=null

**Scenario: VLM 关闭**
- Given `INGEST_VLM_ENABLED !== 'true'`
- Then 全部跳过；返回 chunks 中无 image_caption

**Scenario: VLM 调用失败**
- Given chatComplete 抛错
- Then 该图无 caption；warnings 追加 'vlm caption failed for ...'

**Scenario: 模型可配**
- Given `INGEST_VLM_MODEL=Qwen/Qwen2.5-VL-32B-Instruct`
- Then 调用使用该模型

---

## llm.ts — vision content blocks 扩展

**Scenario: 文本消息保持原样**
- Given content: 'hello'
- Then 走 OpenAI chat completions 的 `content: 'hello'` 普通字段

**Scenario: image_url block**
- Given content: `[{type:'text', text:'X'}, {type:'image_url', image_url:{url:'data:image/png;base64,XXXX'}}]`
- Then 直接透传给上游 API

---

## 启动检查

**Scenario: java 存在**
- Given `java -version` exit 0
- Then 启动日志含 `✓ java detected: openjdk 17.x ...`

**Scenario: java 缺失**
- Given `java -version` 抛 ENOENT 或 exit ≠ 0
- Then 启动日志 WARN：`PDF pipeline v2 unavailable; will fall back to officeparser`
- And 服务正常启动（不退出）

---

## 集成 — POST /api/knowledge/ingest

**Scenario: PDF 走新 pipeline**
- Given 上传 .pdf 且 ODL 可用
- Then `metadata_asset` 写入；`metadata_field` 切片来自 PdfChunk[]；`metadata_asset_image` 行 ≥ 0
- And 响应 body 含 `{assetId, chunks: {l1,l2,l3}, images, tags}`

**Scenario: PDF 降级**
- Given ODL 不可用
- Then 走原 PDFParse v2 路径；`metadata_asset_image` 无新行
- And 响应 body 不含 `images` 字段（或值为 0）

**Scenario: 非 PDF 不受影响**
- Given 上传 .docx
- Then 仍走 mammoth 旧路径
