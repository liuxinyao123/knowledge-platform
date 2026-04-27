# Implementation Plan: DSClaw UI 重构

## Batch 1 — Foundation（配置层）

### Step 1.1: index.css
- 替换 :root，写入全套 CSS 变量
- body 全局样式（font-family, color, background）
- 写入 @layer components：surface-card / panel-head / panel-title / list-row / pill（变体）/ btn / empty-state / kc-tab-bar / kc-tab-item / tree-item / nav-item

### Step 1.2: tailwind.config.js
- extend.colors 添加：p / p-light / p-mid / surface / sidebar / muted / border-c / ds-text

### Step 1.3: App.tsx + McpPage
- `src/knowledge/Mcp/index.tsx` 创建（静态页 skeleton）
- App.tsx 导入并添加 `<Route path="mcp" element={<McpPage />} />`

---

## Batch 2 — Layout + KnowledgeTabs

### Step 2.1: Layout.tsx 重构
- 整体结构：flex h-screen，左 sidebar 240px + 右 main flex-col
- Sidebar：brand 区（紫色渐变 icon + title）+ 搜索框 + NavLink 列表（.nav-item）+ 底部用户信息
- Topbar：50px，面包屑（useLocation 匹配 navItems）
- main → page：flex-1 overflow-y-auto Outlet

### Step 2.2: KnowledgeTabs.tsx
```tsx
const tabs = [
  { to: '/overview', label: '🏠 总览' },
  { to: '/search', label: '🔎 检索' },
  { to: '/spaces', label: '🗂 空间' },
  { to: '/ingest', label: '⬆️ 入库' },
  { to: '/qa', label: '💬 问答' },
  { to: '/governance', label: '🛡 治理' },
  { to: '/mcp', label: '🔌 数据接入' },
]
```
- useLocation 检测 isActive
- 渲染 .kc-tab-bar > .kc-tab-item
- 点击使用 useNavigate 跳转（不用 NavLink 避免样式冲突）

---

## Batch 3 — Overview 重构

### Step 3.1: Overview/index.tsx
- 引入 KnowledgeTabs
- MetricCard 改用 CSS class：.surface-card + 内部 .metric-label / .metric-val + pill 角标
- 待入库：bsApi.getImports → filter pending count（如有此接口，否则固定0）
- 2 列网格布局：左「最近更新」panel + 右「我的收藏」panel

### Step 3.2: 收藏 panel
- 读取 localStorage['kc_favorites']（JSON 数组存 {id,name,url}）
- 2 列小卡片，空态 empty-state

---

## Batch 4 — Search 实现

### Step 4.1: hooks/useDebounce.ts（RED先行）
```ts
export function useDebounce<T>(value: T, delay: number): T
```

### Step 4.2: Search/index.tsx
- state: query, results, selectedResult, typeFilter
- 搜索 hero 区：big-search input + pill 过滤器（全部/文档...）
- split layout：左 360px .surface-card + 右 flex-1 .surface-card
- useEffect(query 防抖) → bsApi.search(debouncedQuery)
- 左：result-item 列表，渲染 preview_html.content（dangerouslySetInnerHTML + hl class）
- 右：选中结果 title + meta + content + 「⭐ 收藏」「打开原文」按钮
- 空态：两侧各自 empty-state

---

## Batch 5 — SpaceTree 样式

### Step 5.1: SpaceTree/index.tsx
- 左侧 aside 改：w-60 .surface-card overflow-hidden shrink-0
- 右侧 main：flex-1 .surface-card overflow-hidden
- 顶部操作栏：「+ 新建空间」「+ 新建知识库」btn

### Step 5.2: TreeNode.tsx
- button className 改为 `.tree-item` + active/loading 变体

### Step 5.3: Modals
- bg-white → surface-card 圆角
- btn 改用全局 .btn / .btn-primary

---

## Batch 6 — QA 实现

### Step 6.1: QA/index.tsx（RED先行）
- state: messages[], inputText, sources[]
- split 布局：左 flex-1 .surface-card + 右 w-[360px] .surface-card
- 左 panel-head：「对话」title + pills
- chat-log：map messages → .msg（用户）/ .msg.user（AI）
- chat-input：textarea + 发送 btn
- handleSend: POST /api/qa/ask，append message，解析 sources
- 右：引用来源 list-row，空态

---

## Batch 7 — Ingest 实现

### Step 7.1: Ingest/index.tsx（RED先行）
- state: file, bookId, importId, steps[], polling
- 左：拖拽区（onDrop + onClick）+ Book 选择器（bsApi.getBooks()）+ 上传 btn
- 右：步骤条（6 步）+ 当前步骤详情卡片 + 历史记录

### Step 7.2: useIngestPoller hook
- 接受 importId
- setInterval 2000ms 调用 bsApi.pollImport(id)
- status=complete/failed 时 clearInterval

---

## Batch 8 — Governance 实现

### Step 8.1: Governance/index.tsx（RED先行）
- state: activeSubtab, users, localRoles
- kc-subtabs（2 个 pill tab）
- 「知识治理」子页：3 列静态 panel
- 成员管理：bsApi.getUsers() → 渲染表格，角色下拉 → setLocalRoles → localStorage

---

## Batch 9 — MCP 静态页

### Step 9.1: Mcp/index.tsx
- 两个 Tool 卡片（search_knowledge / get_page_content）
- 连接状态 banner（静态显示配置状态）

---

## Tests（穿插于各 Batch）

每个有行为的组件先写 RED 测试，再实现。
纯样式组件（CSS class 变更）不需要 functional test。
测试文件：
- `hooks/useDebounce.test.ts`
- `Search/index.test.tsx`（防抖/渲染/收藏）
- `QA/index.test.tsx`（发送/失败）
- `Ingest/index.test.tsx`（上传/轮询停止）
- `Governance/index.test.tsx`（角色保存/同步）
- `components/KnowledgeTabs.test.tsx`（active 路由）
