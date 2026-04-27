# Proposal: PDF Pipeline v2 —— opendataloader-pdf + VLM 图意

## Problem

当前 `extractDocument`（`apps/qa-service/src/services/ingestExtract.ts`）对 PDF 走
`officeparser` + 可选 tesseract OCR，输出**纯平文本**：

- 丢失结构（标题层级 / 章节 / 表格 / bbox）
- 丢失图片（嵌入图直接被抛弃）
- 页眉页脚污染（`GM Confidential` / 页码进入正文）
- 工程演示稿（GM Liftgate / Bumper）这种 image-heavy 文档 **拿到的信息 < 20%**

## Scope（本 Change）

1. **opendataloader-pdf 接入**（结构化抽取）
   - 通过 `@opendataloader/pdf` Node 包装调用 Java CLI
   - 输出 markdown + JSON（含 bbox / heading level / page number / 表格 / 图片元素）
   - 替换 PDF 走 officeparser 的旧路径
2. **图片落档**
   - 从 ODL 输出抽出图片元素（external 模式），保存到 `infra/asset_images/{asset_id}/{page}-{idx}.png`
   - 新表 `metadata_asset_image` 记录 page / bbox / 文件路径 / VLM caption
3. **VLM 图意（opt-in）**
   - 模型：`Qwen/Qwen2.5-VL-72B-Instruct`（硅基流动，复用 EMBEDDING_API_KEY）
   - 触发：开关 `INGEST_VLM_ENABLED=true` 且页面命中 image-heavy 启发（文字 < 300 字 或 图占比高）
   - 调用形式：OpenAI vision content block（`{type:'image_url', image_url:{url:'data:image/png;base64,...'}}`）
   - caption 文本作为额外 chunk 入索引；同步写到 `metadata_asset_image.caption`
4. **运行依赖**
   - 本机：要求 JDK 11+；启动时检查 `java -version`，缺失给清晰错误
   - 容器：新 `apps/qa-service/Dockerfile`，base 切 `node:20` + apt `openjdk-17-jre-headless`
5. **降级策略**
   - ODL 调用失败（JVM 缺失 / convert 抛异常）→ fallback 到现有 officeparser 路径
   - VLM 调用失败 → 该图无 caption，但 chunks 不丢
6. **范围**：**仅 `.pdf`**；`.pptx` 留下一个 change（ODL 不直接吃 pptx）

## Out of Scope

- `.pptx / .docx` 走 ODL（ODL 是 PDF 解析器；pptx 需先转 pdf，留下一个 change）
- 重新索引存量资产（reindex API；走单独 change）
- VLM 缓存 / 图片去重（hash 加速）
- bbox 在前端高亮显示（仅入库，UI 后续做）

## 决策记录

- D-001 解析引擎 = `@opendataloader/pdf`（结构化）；不替换 mammoth/officeparser 对其他格式的处理
- D-002 图片存盘 = 文件系统（`infra/asset_images/`），DB 仅存路径；不进 PG bytea
- D-003 VLM = 硅基 Qwen2.5-VL-72B-Instruct；通过 `INGEST_VLM_ENABLED` 开关
- D-004 image-heavy 阈值 = 单页文字字符 < 300 **或** 图片数 ≥ 3
- D-005 ODL / VLM 失败 = 降级；不阻塞 ingest
- D-006 Java 缺失 = 启动时 WARN（不 fail-fast）；调用时降级
