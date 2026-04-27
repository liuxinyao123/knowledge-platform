# Explore Draft — PDF Pipeline v2

> 草稿。正式契约见 `openspec/changes/pdf-pipeline-v2/`。

## 读的代码

- `apps/qa-service/src/services/ingestExtract.ts` —— 当前 PDF 走 officeparser 平文本
- `apps/qa-service/src/routes/knowledgeDocs.ts` —— /ingest 已切 PDFParse v2（仍只取 text）
- 试跑用户上传 LFTGATE-3：每页 3-4 行文字 + 大图，纯文本只能拿到 ~10% 信息

## 决策依据

opendataloader-pdf 的优势：
- 输出 markdown + JSON（含 bbox、heading level、page#）
- 表格 border + cluster 双方法
- 图片 external 模式（直接落盘）
- 公式 + 图表识别
- MPL-2.0 兼容商用

不足：
- Java 11+ 依赖
- 每文件 spawn JVM ~1-2s
- 无图意语义（只给"这里有图"，不给"这是 push-up vs flip-over 对比"）

→ 决定叠加 VLM 弥补图意；Qwen2.5-VL 复用现有硅基账号；通过 env 开关控制成本。

## 风险

- ODL JSON schema 文档未完整公开，首次集成时可能要按实际输出字段调 parser
- JVM 启动慢；批量场景未来要做常驻 daemon
- VLM token 计费，要监控
