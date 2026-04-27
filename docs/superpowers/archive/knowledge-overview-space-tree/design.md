# Design: 知识中台总览 + 空间管理

## Overview 设计

### 新增 MetricCard：近 7 天新增文档数
- 调用 `bsApi.getPages({ count: 500 })` 获取页面列表
- 客户端过滤：`updated_at >= now - 7 days`（注意字段是 updated_at，因为 BSPage 没有 created_at）
- 显示在第 4 个 MetricCard 位置，grid 改为 `grid-cols-4` 或换行

### 活跃空间 Top5
- 调用 `bsApi.getShelves()` 获取所有 shelves（含 total）
- 对每个 shelf 调用 `bsApi.getShelf(id)` 获取 `{ books: BSBook[] }`
- 按 `books.length` 降序排列，取前 5
- 使用 `useQueries` 并发获取各 shelf 详情（shelf 数量通常较小）

### Skeleton 骨架屏
- 加载状态：MetricCard 区域用 4 个灰色矩形占位
- 列表区域用 3-5 行占位条
- 使用 Tailwind `animate-pulse` + `bg-gray-200` 实现，无需额外库

## SpaceTree 设计

### 组件结构
```
SpaceTree/
├── index.tsx          # 左右分栏容器
├── TreePane.tsx       # 左侧树形面板
├── TreeNode.tsx       # 单个节点（可复用，递归）
├── PreviewPane.tsx    # 右侧 iframe 预览
└── useTreeData.ts     # 数据 hooks
```

### 树节点状态
每个节点维护：
- `expanded: boolean` - 是否展开
- `loading: boolean` - 子节点加载中
- `children: TreeItem[]` - 已加载的子节点

### 数据加载策略（懒加载）
- Shelf 列表：页面挂载时加载（`bsApi.getShelves()`）
- Shelf 展开：点击时调用 `bsApi.getShelf(id)` → 得到 `books[]`
- Book 展开：点击时调用 `bsApi.getBook(id)` → 得到 `contents[]`（type 区分 chapter/page）
- Chapter 展开：点击时调用 `bsApi.getChapter(id)` → 得到 `pages[]`
- Page 点击：设置 `selectedPageUrl`，右侧 iframe src 指向 `page.url`

### 节点类型区分
```ts
type NodeType = 'shelf' | 'book' | 'chapter' | 'page'
interface TreeItem {
  id: number
  name: string
  type: NodeType
  url?: string
  hasChildren: boolean
  children?: TreeItem[]
  loaded: boolean
}
```

### 布局
```
┌────────────────┬─────────────────────────────┐
│  Space Tree    │                             │
│  (w-72, 固定)  │   iframe 预览区域           │
│                │   (flex-1)                  │
│  ▶ Shelf A     │                             │
│    ▶ Book 1    │   [选中 Page 后显示]        │
│      Chapter 1 │                             │
│      Page 1 ←  │                             │
└────────────────┴─────────────────────────────┘
```

### iframe 安全说明
- `src` 指向 BookStack 原页 URL（同局域网访问）
- `sandbox` 属性设为 `allow-same-origin allow-scripts`
- 未选中 Page 时显示提示文字

## 技术选型
- React local state（useState）管理树节点展开/收起，避免过度引入全局状态
- TanStack Query 用于 Overview 的数据获取（已有 QueryClient）
- SpaceTree 使用手动 fetch（useCallback + useState）实现懒加载，避免大量 queryKey 管理复杂度
- Tailwind CSS `animate-pulse` 实现 Skeleton
