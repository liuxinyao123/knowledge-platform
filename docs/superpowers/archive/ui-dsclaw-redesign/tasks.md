# Tasks: DSClaw UI 重构

## Batch 1 — Foundation
- [x] F-1: index.css 写入 CSS 变量 + 全局样式 + @layer components
- [x] F-2: tailwind.config.js 新增 DSClaw 颜色 token
- [x] F-3: App.tsx 新增 /mcp 路由 + McpPage 占位符创建

## Batch 2 — Layout + KnowledgeTabs
- [x] L-1: Layout.tsx 全量重构（浅色侧边栏 + Topbar）
- [x] L-2: KnowledgeTabs.tsx 新建（7 tabs + active 路由检测）

## Batch 3 — Overview 重构
- [x] OV-1: MetricCard 样式改 DSClaw 规范（CSS class）
- [x] OV-2: 「我的收藏」panel（localStorage kc_favorites）
- [x] OV-3: 页头按钮区（+ 新建空间 / 导入知识）

## Batch 4 — Search 全量实现
- [x] SR-1: 防抖 hook（useDebounce）
- [x] SR-2: 搜索 Hero 区 + pill 过滤器
- [x] SR-3: 结果列表（.result-item + .hl 高亮）
- [x] SR-4: 预览面板（title + meta + html content + 收藏按钮）
- [x] SR-5: 空态 empty-state

## Batch 5 — SpaceTree 样式更新
- [x] ST-1: 左右 panel 容器改 .surface-card
- [x] ST-2: TreeNode 改用 .tree-item 样式
- [x] ST-3: CreateShelfModal / CreateBookModal 改用 .btn + .surface-card

## Batch 6 — QA 全量实现
- [x] QA-1: 对话 panel（chat-log + chat-input）
- [x] QA-2: 引用来源 panel（右 360px）
- [x] QA-3: POST /api/qa/ask 调用 + 错误处理
- [x] QA-4: 空态 + 推荐问题

## Batch 7 — Ingest 全量实现
- [x] IN-1: 拖拽上传区 + Book 选择器
- [x] IN-2: 步骤条组件（6 步，3 种状态）
- [x] IN-3: 轮询逻辑（useInterval + bsApi.pollImport）
- [x] IN-4: 历史记录 panel（localStorage kc_imports_history）

## Batch 8 — Governance 全量实现
- [x] GV-1: kc-subtabs（知识治理/资产目录/数据权限）
- [x] GV-2: 知识治理子页 3 列 panel（静态 mock）
- [x] GV-3: 审计日志 table（bsApi.getUsers() 数据）
- [x] GV-4: 成员管理 panel（localStorage 角色 + 同步按钮）

## Batch 9 — MCP 静态页
- [x] MC-1: Tool 卡片（search_knowledge / get_page_content）
- [x] MC-2: 连接状态 banner

## Tests
- [x] TE-1: KnowledgeTabs active 路由测试
- [x] TE-2: Search 防抖测试（< 2 字不请求，快速输入只触发 1 次）
- [x] TE-3: Search 结果渲染 + 空态测试
- [x] TE-4: Search 收藏写入 localStorage 测试
- [x] TE-5: QA 发送消息调用 API 测试
- [x] TE-6: QA 请求失败不抛出测试
- [x] TE-7: Ingest 上传触发 createImport 测试
- [x] TE-8: Ingest 轮询在 status=complete 时停止测试
- [x] TE-9: Governance 角色保存到 localStorage 测试
- [x] TE-10: Governance 同步调用 updateUserRoles 测试
