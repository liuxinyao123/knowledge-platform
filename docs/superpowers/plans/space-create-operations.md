# Implementation Plan: 空间操作

## Step 1: bsApi — createShelf + createBook
File: `apps/web/src/api/bookstack.ts`
- 在 bsApi 对象末尾追加两个方法

## Step 2: CreateShelfModal
File: `apps/web/src/knowledge/SpaceTree/CreateShelfModal.tsx`
- props: `{ open, onClose, onCreated }`
- state: name, description, error, submitting
- name 空时 confirm button disabled
- submit → bsApi.createShelf → onCreated() / setError

## Step 3: CreateBookModal
File: `apps/web/src/knowledge/SpaceTree/CreateBookModal.tsx`
- props: `{ open, shelfId, shelfName, onClose, onCreated }`
- state: name, error, submitting
- submit → bsApi.createBook({ name, shelf_id: shelfId }) → onCreated() / setError

## Step 4: TreeNode — shelf 「+」按钮
File: `apps/web/src/knowledge/SpaceTree/TreeNode.tsx`
- 新增 prop `onAddBook?: (shelfId: number, shelfName: string) => void`
- shelf 节点外层 button 改为 `group` div + 内部 button
- 尾部添加 `<button onClick={e => { e.stopPropagation(); onAddBook?.(item.id, item.name) }}>`
- `opacity-0 group-hover:opacity-100 transition-opacity`

## Step 5: TreePane — 整合 Modals + 刷新逻辑
File: `apps/web/src/knowledge/SpaceTree/TreePane.tsx`
- state: `createShelfOpen`, `createBookTarget: { shelfId, shelfName } | null`
- Header 加「+」按钮触发 createShelfOpen
- `handleShelfCreated`: 重新 fetch getShelves，合并已展开状态
- `handleBookCreated(shelfId)`: 若该 shelf loaded，重新 fetch getShelf(shelfId) 刷新 children
- 渲染 CreateShelfModal + CreateBookModal

## Step 6: Tests (RED first)
Files:
- `CreateShelfModal.test.tsx`
- `CreateBookModal.test.tsx`
- `TreeNode.test.tsx`（「+」按钮不冒泡）
