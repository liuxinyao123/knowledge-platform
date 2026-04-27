# Tasks: 知识中台总览 + 空间管理

## Overview 任务

- [x] OV-1: 重构 MetricCard 区域为 4 列，新增「近 7 天新增」卡片（按 updated_at 过滤）
- [x] OV-2: 新增 Skeleton 组件（MetricCard 骨架 + 列表行骨架）
- [x] OV-3: 新增「活跃空间 Top5」区块（useQueries 并发获取 shelf 详情，按 book 数量排序）
- [x] OV-4: 给 MetricCard 区域和列表区域加载时挂接 Skeleton

## SpaceTree 任务

- [x] ST-1: 创建 TreeNode 数据类型定义
- [x] ST-2: 实现 TreePane.tsx（懒加载树，管理展开状态和子数据）
- [x] ST-3: 实现 PreviewPane.tsx（iframe 预览，未选中时显示提示）
- [x] ST-4: 组合 SpaceTree/index.tsx（左右分栏布局）

## 测试任务

- [x] TE-1: Overview 单元测试：Skeleton 在 isLoading 时渲染
- [x] TE-2: Overview 单元测试：近 7 天过滤逻辑正确
- [x] TE-3: SpaceTree 单元测试：点击 Shelf 节点后展开/收起
- [x] TE-4: SpaceTree 单元测试：点击 Page 节点后更新 iframe src
