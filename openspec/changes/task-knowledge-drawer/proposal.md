# Proposal: task-knowledge-drawer (G8)

## 背景

PRD §16 DSClaw 任务侧"知识抽屉"——任务详情页嵌入一个侧抽屉，自动调起与该任务最相关的知识（文档片段 + 操作审计）。

DSClaw 真客户端我们控制不了，但：
- 知识中台这边必须提供"根据任务上下文查相关知识"的 API
- 提供一个可嵌入的 Drawer 组件，便于 DSClaw 集成
- 在本系统里自带一个 demo 页（/task-demo）方便验证

## 范围

### IN

- 后端：`POST /api/knowledge/task-context`
  - 输入：`{ taskId, title, description? }`
  - 返：`{ relatedAssets: [5 条], recentAudits: [5 条提到该 task 的 audit_log] }`
  - 相关性：用 pgvector 做 title+description 的语义检索（沿用 embedTexts）
  - 全量 mock fallback：embeddings 未配置时返 "演示数据" + 排序按 updated_at
- 前端：
  - `<TaskKnowledgeDrawer taskId title description?>` 独立组件
  - 内含两 Tab：相关知识 / 相关审计
  - 可嵌入任意页（DSClaw 通过 iframe 或前端集成调用）
- Demo 页 `/task-demo`：顶部 task 输入框，点"加载"调 drawer；用于 QA

### OUT

- DSClaw 集成本身（postMessage / iframe 封装）—— 由 DSClaw 侧后续做
- Drawer 的拖拽、全屏、keyboard shortcut —— 先 MVP
- 基于 LLM 的"任务摘要生成" —— 太重，后续
- 审计联动（在 drawer 里点 audit 跳对应资产）—— 简化掉

## 验证

- TS 双 0
- 本机：/task-demo 输入"供应商资质核查" → Drawer 列出 5 条语义最近的资产
- embeddings 未配置时：Drawer 顶部挂"演示数据"警告 + 按 updated_at 列
