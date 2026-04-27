# Spec: 知识中台总览 + 空间管理

## Overview — MetricCard 近 7 天新增文档数

**Given** Overview 页面加载完成  
**When** pages API 返回数据  
**Then** 展示第 4 个 MetricCard，label 为「近 7 天新增」，value 为 `updated_at >= now-7days` 的页面数量

**Given** 任意 API 请求 pending 中  
**When** 渲染 MetricCard 区域  
**Then** 展示 4 个灰色 `animate-pulse` 骨架占位块

## Overview — 活跃空间 Top5

**Given** shelves API 返回非空数据  
**When** 所有 shelf 详情加载完成  
**Then** 展示最多 5 个空间，按 books 数量降序排列，显示 shelf 名称和 book 数量

**Given** shelf 详情加载中  
**When** 渲染「活跃空间」区域  
**Then** 展示 5 行骨架占位条

## SpaceTree — 树形结构

**Given** SpaceTree 页面挂载  
**When** 渲染完成  
**Then** 左侧展示所有 Shelf 列表（折叠状态），右侧显示「请选择一个页面预览」

**Given** 用户点击 Shelf 节点（未展开）  
**When** API `getShelf(id)` 返回  
**Then** 节点展开，显示其下 Books 列表

**Given** 用户点击 Book 节点（未展开）  
**When** API `getBook(id)` 返回  
**Then** 节点展开，显示 contents（Chapter 和直属 Page）

**Given** 用户点击 Chapter 节点（未展开）  
**When** API `getChapter(id)` 返回  
**Then** 节点展开，显示 pages 列表

**Given** 用户点击 Page 节点  
**When** 点击事件触发  
**Then** 右侧 iframe src 更新为 page.url，显示 BookStack 原页内容

**Given** 节点正在加载子数据  
**When** 渲染该节点  
**Then** 节点旁显示 loading spinner（animate-spin）

**Given** 已展开的节点再次点击  
**When** 点击事件触发  
**Then** 节点收起，隐藏子节点（不清除已加载数据，避免重复请求）

## 布局约束

- SpaceTree 左侧面板宽度固定 `w-72`（288px），不可拖拽
- 右侧 iframe 占满剩余宽度（`flex-1`）
- 整体高度 `h-full`，与 Layout main 区域对齐
- 左侧面板内部可独立滚动（`overflow-y-auto`）
