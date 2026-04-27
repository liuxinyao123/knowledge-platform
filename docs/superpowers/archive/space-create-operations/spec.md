# Spec: 空间操作（新建 Shelf / Book）

## bsApi.createShelf

**Given** 调用 `bsApi.createShelf({ name: 'Test', description: '' })`
**When** POST /api/shelves 成功
**Then** 返回包含 id 和 name 的 BSShelf 对象

## bsApi.createBook

**Given** 调用 `bsApi.createBook({ name: 'Guide', shelf_id: 1 })`
**When** POST /api/books 成功
**Then** 返回包含 id 和 name 的 BSBook 对象

## CreateShelfModal — 表单提交

**Given** 用户点击「+ 新建空间」按钮
**When** 弹窗打开
**Then** 显示 name 输入框和 description 文本框，确认按钮初始 disabled（name 为空时）

**Given** 用户填写 name 并点击「创建」
**When** API 调用成功
**Then** 弹窗关闭，顶层 shelf 列表刷新（新 shelf 出现在列表中）

**Given** API 返回 403
**When** 创建请求完成
**Then** 弹窗内显示「无操作权限」，弹窗不关闭

**Given** API 返回非 403 错误
**When** 创建请求完成
**Then** 弹窗内显示「创建失败，请重试」

## CreateBookModal — 表单提交

**Given** 用户点击某 Shelf 节点的「+」按钮
**When** 弹窗打开
**Then** 显示 name 输入框，shelf 名称作为提示文字展示（不可编辑）

**Given** 用户填写 name 并点击「创建」，目标 Shelf 已展开（loaded=true）
**When** API 调用成功
**Then** 弹窗关闭，该 Shelf 的 children 刷新（新 book 出现在展开列表中）

**Given** API 返回 403 或其他错误
**When** 创建请求完成
**Then** 对应错误提示显示在弹窗内

## TreeNode — Shelf 「+」按钮

**Given** 渲染 type=shelf 的节点
**When** 鼠标悬停到该节点行
**Then** 节点行尾显示「+」按钮（`opacity-0 group-hover:opacity-100`）

**Given** 用户点击 shelf 节点行尾「+」按钮
**When** 点击事件触发
**Then** 阻止冒泡（不触发展开/收起），打开 CreateBookModal
