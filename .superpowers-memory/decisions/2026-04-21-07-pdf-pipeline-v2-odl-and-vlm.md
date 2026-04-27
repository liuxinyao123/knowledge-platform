# ADR 2026-04-21-07 · PDF Pipeline v2 = opendataloader + Qwen2.5-VL

## Context

PDF / 工程演示稿（GM Liftgate / Bumper 等）现走 officeparser 平文本，丢失 80%+ 信息：
- 结构（heading / 章节）丢失
- 表格变线性文本
- 图片整体丢弃
- 页眉页脚污染正文

## Decision

1. **结构化抽取** = `@opendataloader/pdf`
   - Java CLI；Node 包装动态 import 软依赖；缺失降级到 officeparser
2. **图片落档** = 文件系统 `infra/asset_images/{assetId}/{page}-{idx}.png`
   - DB 仅存路径（`metadata_asset_image` 新表）
3. **图意 VLM** = `Qwen/Qwen2.5-VL-72B-Instruct`（硅基），opt-in（`INGEST_VLM_ENABLED`）
   - 仅对 image-heavy 页（文字 < 300 字 或 图 ≥ 3 张）调
4. **运行依赖** = JDK 11+；本机 brew install；Docker 镜像 `node:20 + openjdk-17-jre-headless`
5. **降级链** = ODL 失败 → officeparser；VLM 失败 → 该图无 caption 但 chunks 不丢
6. **本 change 范围** = `.pdf` only；`.pptx` 留下一个 change

## Consequences

**正面**
- LFTGATE 这种 deck-style PDF 信息保留 80%+（vs 旧 ~20%）
- bbox 信息为未来"原文区块跳转"留口子
- 不破坏 docx/xlsx/csv 处理

**负面**
- JDK 依赖增加部署 footprint
- 每 PDF JVM 启动 ~1-2s；后续要常驻 daemon 优化
- VLM 调用 token 成本（可关）

## Links

- proposal/design/spec/tasks: `openspec/changes/pdf-pipeline-v2/`
- 触发文档样本：用户 2026-04-21 上传的 GM LFTGATE PDF
