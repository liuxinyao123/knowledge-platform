# Proposal: 空间操作（新建 Shelf / Book）

## Problem

SpaceTree 已实现四层懒加载树和 iframe 预览，但缺少内容创建入口。
用户（管理员）无法在前端新建 Shelf 或 Book，只能通过 BookStack 原站操作。

## Proposed Change

1. `bsApi` 新增 `createShelf` 和 `createBook` 两个方法
2. 侧边栏 Header 加「+ 新建空间」按钮 → 弹出 CreateShelfModal
3. 每个 Shelf 节点行尾加「+」按钮 → 弹出 CreateBookModal（预填 shelf_id）
4. 创建成功后刷新对应层级的树节点
5. API 返回 403 时展示「无操作权限」错误提示（方案 A：不做前端 admin 检测）
