# Proposal: 知识中台全面重构——对齐 DSClaw 设计规范

## Problem

当前 UI 使用深色青绿侧边栏 + 零散 Tailwind 工具类，与 DSClaw 原型设计语言不一致：
- 颜色体系未统一（散落的 knowledge-* 色），缺少 CSS 变量层
- 侧边栏深色主题（knowledge-900）需换为浅色（#FAFAFA）
- 4 个页面（Search / QA / Ingest / Governance）仍是 TODO 占位符
- 缺少 KnowledgeTabs 顶部 Tab 导航组件
- 缺少 /mcp 路由和 MCP 数据接入静态页

## Proposed Change

1. **Design Token 层**：index.css + tailwind.config.js 写入 DSClaw 颜色系统
2. **Layout 重构**：侧边栏浅色 + Topbar（50px 面包屑）
3. **KnowledgeTabs**：抽取共享 Tab 导航组件，7 个路由
4. **通用组件样式**：surface-card / pill / empty-state / btn / list-row / panel-head（写入 index.css @layer components）
5. **Overview 重构**：MetricCard 样式升级 + 我的收藏面板（localStorage）
6. **Search 全量实现**：防抖搜索 + split 结果/预览布局
7. **SpaceTree 重新样式**：panel 容器 + tree-item 紫色主题
8. **QA 全量实现**：对话 UI + 引用来源 panel，调用 POST /api/qa/ask
9. **Ingest 全量实现**：上传 + 步骤进度条 + 轮询 bsApi.pollImport
10. **Governance 全量实现**：localStorage 角色表 + BookStack API 同步
11. **MCP 静态页**：Tool 列表 + 连接状态 banner
12. **App.tsx**：新增 /mcp 路由

## 方案选择记录

- Governance MySQL → 方案 A（localStorage + BookStack API 同步）
