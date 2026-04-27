# Proposal: ingest-ui-rich (G6)

## 背景

现在 `/ingest` 是单文件 + 6 步进度条 quick flow。PRD §7 要求"入库向导"级体验：
- 多文件队列
- 每文件可看解析预览 + 编辑元数据（tags / 摘要）再提交
- 最近入库历史一览

后端 `/api/ingest/extract-text` + `/api/asset-directory/register-bookstack-page` 已支持，缺"history"端点。

## 动机

- 现状只能一次一个文件，对批量入库的运营同学非常痛
- 解析后"眼见为实"才提交，能减少 RAGFlow 里发现脏数据回头删的成本
- 最近 10 条入库历史能作为入口二次访问 /assets/:id

## 范围

### IN

- 后端新增 `GET /api/ingest/recent?limit=10` —— 从 audit_log 读 action LIKE `ingest_%` 最近 N 条
- 前端重写 `/ingest`：
  - 顶部 4 步骤指示器（1. 选择 / 2. 预览 / 3. 元数据 / 4. 提交）
  - 多文件队列（左侧）：可增/删/选中，单文件状态 pending / parsing / parsed / uploading / done / failed
  - 中间预览区：选中文件的解析结果（text 模式显 markdown 预览 + 字数；attachment 模式显 hint）
  - 右侧元数据表单：tags（逗号分隔）+ 摘要（可覆盖默认）+ category（下拉：规章/合同/技术/报表/其它）
  - 底部 Recent Imports 面板 —— 最近 10 条，点击跳转 /assets/:id（可用时）
  - "一键提交全部"按钮：顺序跑 extract → createPage → registerBookstackPageForAssets
- 保留 ZIP 走 `/api/bookstack` 导入的旧路径作为"书籍批量导入"Tab

### OUT

- 文件夹批量 —— 已有 SSE `/api/ingest/scan-folder` 单独 UI，不在本 change
- 真正的并发上传 —— MVP 串行；后续按用户反馈加 worker pool
- 元数据字段可配置化 —— 本期硬编码 category 枚举
- 失败自动重试 —— 只给"重试"按钮，用户手动

## 决策依赖

- G1 已提供 tags 后端与 audit_log；G5 已提供 /assets/:id 详情入口

## 验证

- `tsc --noEmit` 双 0
- 选 3 个文件（.md / .pdf / .dwg）→ 点"解析" → 3 个都变 parsed → 编辑一个 tags → "提交全部" → 看到 3 绿 done
- Recent Imports 下方出现这 3 条；点跳转 /assets/:id
