# Design: 空间操作（新建 Shelf / Book）

## API 层

### bsApi.createShelf
```ts
createShelf: (data: { name: string; description?: string }) =>
  client.post<BSShelf>('/shelves', data).then(r => r.data)
```

### bsApi.createBook
```ts
createBook: (data: { name: string; shelf_id?: number }) =>
  client.post<BSBook>('/books', data).then(r => r.data)
```

## 组件结构

```
SpaceTree/
├── index.tsx             # 新增：传 onShelfCreated 给 TreePane
├── TreePane.tsx          # 新增：接受 onShelfCreated，Header 加按钮，Shelf 节点加「+」
├── TreeNode.tsx          # 新增：shelf 类型节点尾部渲染「+」按钮
├── CreateShelfModal.tsx  # 新增
├── CreateBookModal.tsx   # 新增
└── ...（其余不变）
```

## CreateShelfModal

- 触发：侧边栏 Header「+ 新建空间」按钮
- 字段：name（必填）、description（选填）
- 提交：调用 `bsApi.createShelf`
- 成功：关闭弹窗，TreePane 重新拉取 shelves（`setItems` 追加新节点或重新 fetch）
- 失败 403：弹窗内显示「无操作权限」
- 失败其他：显示「创建失败，请重试」

## CreateBookModal

- 触发：Shelf 节点行末「+」按钮（阻止事件冒泡，不触发展开）
- 字段：name（必填），shelf_id 由调用方传入（不展示给用户）
- 提交：调用 `bsApi.createBook({ name, shelf_id })`
- 成功：关闭弹窗，若该 Shelf 已展开则刷新其 children（重新 fetch + 更新 state）
- 失败同上

## 错误处理

- axios 拦截器已有 401 处理
- Modal 内部 catch axios error：
  - `err.response?.status === 403` → 「无操作权限」
  - 其他 → 「创建失败，请重试」

## 刷新策略

- CreateShelf 成功：重新调用 `bsApi.getShelves()` 刷新顶层列表（保持已展开节点状态）
- CreateBook 成功：若目标 Shelf 已 loaded，重新调用 `bsApi.getShelf(shelfId)` 刷新其 books

## Modal 样式

- 固定居中遮罩（`fixed inset-0 bg-black/40 flex items-center justify-center z-50`）
- 白色卡片 `w-96 bg-white rounded-xl p-6 shadow-xl`
- 按钮：确认（knowledge-500 primary）、取消（gray outline）
