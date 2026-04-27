# Design: 知识中台全面重构——DSClaw 规范

## 1. Design Token 层

### index.css
```css
:root {
  --p: #6C47FF; --p-light: #F0ECFF; --p-mid: #D8CDFF;
  --green: #00B96B; --green-bg: #E6FAF2;
  --amber: #F59E0B; --amber-bg: #FEF3CD;
  --red: #EF4444; --red-bg: #FEE2E2;
  --blue: #3B82F6; --blue-bg: #EFF6FF;
  --sidebar: #FAFAFA; --sidebar-w: 240px;
  --text: #1A1A2E; --muted: #8B8FA8;
  --border: #EBEBF0; --surface: #F7F7FA;
}
body { font-family: -apple-system,'PingFang SC','Hiragino Sans GB',sans-serif; color: var(--text); }
```

### tailwind.config.js 新增色票
```js
p:'#6C47FF', 'p-light':'#F0ECFF', 'p-mid':'#D8CDFF',
surface:'#F7F7FA', sidebar:'#FAFAFA', muted:'#8B8FA8',
'border-c':'#EBEBF0', 'ds-text':'#1A1A2E'
```

### 全局 @layer components（index.css）
- `.surface-card` — bg:#fff, border-radius:14px, border:1.5px solid var(--border)
- `.panel-head` — flex, padding:12px 14px, border-bottom:1px solid var(--border)
- `.panel-title` — 13.5px, font-weight:800
- `.list-row` — flex, padding:12px 14px, border-top:1px solid var(--border), hover:bg var(--surface)
- `.pill` — 11.5px, padding:3px 9px, border-radius:20px; 颜色变体 .green/.blue/.amber/.red/.purple
- `.btn` — padding:8px 16px, border-radius:9px, 13px font-weight:600; `.btn-primary` 紫底白字
- `.empty-state` — flex-col center, padding:60px 24px
- `.kc-tab-bar` — bg:var(--surface), border:1px solid var(--border), border-radius:12px, padding:10px 12px
- `.kc-tab-item` — bg:#fff, border:1px solid var(--border), border-radius:10px, padding:7px 12px
  - active: bg:var(--p-light), border-color:var(--p-mid), color:var(--p)
- `.tree-item` — padding:7px 10px, border-radius:10px, color:var(--muted)
  - hover: bg:var(--surface); active: bg:var(--p-light), color:var(--p), font-weight:700

## 2. Layout 组件

### 侧边栏（240px，#FAFAFA，右边框）
- Brand 区：10px border-radius 紫色渐变方块图标 + 「知识中台」font-weight:700
- 搜索框：白底，border:1px solid var(--border)，border-radius:9px
- NavLink 列表：使用 `.nav-item` 类，active 态 bg:var(--p-light) + color:var(--p)
- 底部用户信息：紫色渐变头像 + 姓名（13px font-weight:600）

### Topbar（50px，白底，底部边框）
- 面包屑：`useLocation()` 匹配 navItems 自动生成，13px muted→当前页 font-weight:600

### 整体结构
```
<div class="app">           // flex h-screen
  <Sidebar />               // 240px shrink-0
  <div class="main">        // flex-1 flex flex-col
    <Topbar />              // h-[50px]
    <div class="page">      // flex-1 overflow-y-auto
      <Outlet />
    </div>
  </div>
</div>
```

## 3. KnowledgeTabs 组件

- 文件：`src/components/KnowledgeTabs.tsx`
- 使用 `useNavigate` + `useLocation` 检测 active 路由
- 7 个 tab：总览/检索/空间/入库/问答/治理/数据接入 → 对应路由
- 渲染于每个 knowledge 页面顶部（Overview/Search/SpaceTree/Ingest/QA/Governance/MCP 各自引入）

## 4. 各页面设计

### Overview
- 4 列 MetricCard：文档条目/知识空间/待入库/异常0（pill 角标）
- 下方 2 列：「最近更新」列表 + 「我的收藏」（localStorage key: `kc_favorites`）
- 我的收藏：2 列卡片，空态显示 emoji + 「去检索」按钮

### Search（全量实现）
- Hero 搜索框（big-search）+ pill 过滤器（全部/文档/会议纪要/FAQ/网页 → client-side type filter）
- split layout：左 360px 结果列表 + 右 flex-1 预览
- 防抖 300ms，< 2 字不请求，调用 `bsApi.search()`
- result-item 渲染 `preview_html.content`（含 <strong> 标签 → `.hl` 样式）
- 点击结果：右侧预览更新（title + meta + html content）
- 「⭐ 收藏」操作：写入 localStorage `kc_favorites`

### SpaceTree（仅样式更新）
- 左 240px panel + 右 flex-1 panel
- 树节点改用 `.tree-item` 样式
- CreateShelfModal / CreateBookModal 样式统一到 `.btn` + `.surface-card`

### QA（全量实现）
- split：左 flex-1 对话区 + 右 360px 引用来源
- chat-log：用户消息（左，bg:var(--surface)）/ AI 消息（右，bg:var(--p-light)）
- chat-input：textarea + 「发送」按钮（`.btn-primary`）
- 调用 POST /api/qa/ask（代理已配置，:3001），失败时显示 empty-state
- 空态：emoji 🧠 + 推荐问题列表

### Ingest（全量实现）
- 左：拖拽上传区（.md/.html/.txt/.zip）+ Book 选择器（bsApi.getBooks()）+ 「上传」按钮
- 右：6 步步骤条（上传/解析/OCR/表格提取/切分/向量化），轮询 bsApi.pollImport(id)
  - 步骤状态：done（绿色）/ active（紫色 pulse）/ waiting（灰色）
- 历史入库记录（localStorage key: `kc_imports_history`）

### Governance（全量实现）
- kc-subtabs：知识治理 / 资产目录 / 数据权限
- 知识治理子页：标签体系 / 重复检测 / 质量评分 3 列 panel（静态 mock 数据）
- 审计日志 table（bsApi.getUsers() 返回数据渲染为 table）
- 成员管理：用户列表（bsApi.getUsers()），角色下拉 → 写 localStorage `kc_user_roles`，「同步」触发 bsApi.updateUserRoles()

### MCP（静态）
- search_knowledge / get_page_content 两个 Tool 卡片
- 连接状态 banner：BookStack URL + Token 状态（从 env 读取或显示「未配置」）

## 5. 新增路由
App.tsx 增加 `<Route path="mcp" element={<McpPage />} />`
