# Implementation Plan: 知识中台总览 + 空间管理

## Step 1: Overview — Skeleton 组件
File: `apps/web/src/knowledge/Overview/Skeleton.tsx`
- MetricCardSkeleton: 4 个 `animate-pulse bg-gray-200 rounded-lg h-24` 块
- ListRowSkeleton: N 行 `animate-pulse bg-gray-200 rounded h-9` 条

## Step 2: Overview — 近 7 天过滤 + 4 指标卡片
File: `apps/web/src/knowledge/Overview/index.tsx`
- getPages 改为 `count: 500`（拉足够多数据做客户端过滤）
- 计算 `recentCount = pages.filter(p => new Date(p.updated_at) >= sevenDaysAgo).length`
- MetricCard 区域改为 `grid-cols-2 md:grid-cols-4`，加第 4 张卡「近 7 天新增」
- isLoading 时渲染 `<MetricCardSkeleton />`

## Step 3: Overview — 活跃空间 Top5
File: `apps/web/src/knowledge/Overview/index.tsx`
- `useQueries` 并发拉取每个 shelf 详情：`shelves.data?.data.map(s => ({ queryKey: ['shelf', s.id], queryFn: () => bsApi.getShelf(s.id) }))`
- 排序：`shelfDetails.sort((a,b) => b.books.length - a.books.length).slice(0,5)`
- 渲染：名称 + book 数量的列表行
- 加载中渲染 `<ListRowSkeleton count={5} />`

## Step 4: SpaceTree — 类型定义
File: `apps/web/src/knowledge/SpaceTree/types.ts`
- `NodeType = 'shelf' | 'book' | 'chapter' | 'page'`
- `TreeItem { id, name, type, url?, hasChildren, children?, loaded }`

## Step 5: SpaceTree — TreePane 懒加载树
File: `apps/web/src/knowledge/SpaceTree/TreePane.tsx`
- state: `items: TreeItem[]`（顶层 shelves）
- 挂载时 fetch shelves，映射为 TreeItem（`hasChildren: true, loaded: false`）
- `handleToggle(item)`:
  - 若已加载：toggle expanded
  - 若未加载：fetch children，更新 item.children + loaded
- getChildren by type: shelf→getShelf, book→getBook, chapter→getChapter
- 递归渲染 `<TreeNode>` 组件

## Step 6: SpaceTree — TreeNode 节点
File: `apps/web/src/knowledge/SpaceTree/TreeNode.tsx`
- props: `item, depth, onToggle, onSelectPage, selectedPageUrl`
- 图标：shelf=🗂 book=📚 chapter=📂 page=📄（或 Heroicons SVG 小图标，如果已有）
- 展开箭头：`▶` / `▼`（旋转 transition）
- loading 时显示 `animate-spin` 圆圈
- 递归渲染 children

## Step 7: SpaceTree — PreviewPane
File: `apps/web/src/knowledge/SpaceTree/PreviewPane.tsx`
- `pageUrl` prop
- 无 URL：灰色提示「← 从左侧选择一个页面」
- 有 URL：`<iframe src={pageUrl} sandbox="allow-same-origin allow-scripts" className="w-full h-full border-0" />`

## Step 8: SpaceTree — index.tsx 组合
File: `apps/web/src/knowledge/SpaceTree/index.tsx`
- state: `selectedPageUrl: string | null`
- 左右 flex 分栏，左 `w-72 border-r overflow-y-auto`，右 `flex-1`

## Step 9: 测试
Files: `Overview/index.test.tsx`, `SpaceTree/TreePane.test.tsx`
- Mock `bsApi`，验证 Skeleton / 过滤逻辑 / 展开收起
