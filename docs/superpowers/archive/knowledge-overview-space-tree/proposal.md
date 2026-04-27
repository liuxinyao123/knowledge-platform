# Proposal: 知识中台总览完善 + 空间管理实现

## Problem

1. Overview 页缺少「近 7 天新增文档数」指标和「活跃空间 Top5」模块，加载时无骨架屏。
2. SpaceTree 页面是空占位符，空间管理功能完全缺失。

## Proposed Change

### Overview 补充
- MetricCard 新增「近 7 天新增文档数」（通过 `updated_at` 过滤最近 7 天的 pages）
- 新增「活跃空间 Top5」列表（获取所有 shelf 的详情，按 books 数量降序排列取前 5）
- 所有数据区块加载时展示 Skeleton 骨架屏

### SpaceTree 实现
- 四层懒加载树：Shelf → Book → Chapter → Page
- 展开 Shelf 调用 `bsApi.getShelf(id)` 获取其 books
- 展开 Book 调用 `bsApi.getBook(id)` 获取 contents（chapters + pages）
- 展开 Chapter 调用 `bsApi.getChapter(id)` 获取 pages
- 点击 Page 在右侧 iframe 预览 BookStack 原页
- 左右分栏布局（树 + iframe 预览）
