# ADR 2026-04-21-13 · 入库向导 UI 细化（PRD §7 / G6）

## Context

/ingest 当前是单文件 + 6 步进度条 quick 模式。PRD §7 期待向导级体验：多文件队列、解析预览、元数据编辑、最近历史。

后端 extract-text + register-bookstack-page 已全，只缺 history 端点。

## Decision

1. 顶部 Tab：`[向导] [ZIP 批量]` —— 新旧并存，ZIP 走旧 `/api/bookstack` 流程保留
2. 向导 4 步状态机：选择 → 预览 → 元数据 → 提交；不强制线性（用户可在任意步返回）
3. 队列串行解析/提交：并发 worker pool 推到 Phase 2
4. 元数据 `category` 硬编码 5 档（规章/合同/技术/报表/其它）；字段可配置化推后
5. Recent Imports 直接读 audit_log，不建 import_history 专用表；每 10 秒轮询
6. 失败行保留在队列，给"重试"按钮单独重跑；不自动重试

## Consequences

**正面**
- 批量入库的运营 pain 点缓解 —— 一次可处理数十文件
- 解析预览让脏数据入库前可发现（减少 RAGFlow 侧回头清理）
- Recent Imports 作为入口二次访问 /assets/:id 闭环

**负面 / 取舍**
- 串行解析大文件时等待时间线性累加 —— 先简单再优化
- audit_log 读路径若历史量大（百万级）性能有顾虑 —— LIMIT 10 + id DESC 索引友好，短期不是瓶颈
- category 枚举硬编码导致扩字段需发版 —— 接受

## Links

- openspec/changes/ingest-ui-rich/
- PRD §7 文档入库
- ADR 2026-04-21-11 assets-and-mcp-ui（/assets/:id 入口）
