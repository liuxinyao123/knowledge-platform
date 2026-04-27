# Design: ingest-ui-rich

## 后端

### GET /api/ingest/recent?limit=10

```sql
SELECT id, principal_email, action, target_type, target_id, detail, created_at
FROM audit_log
WHERE action LIKE 'ingest\\_%' ESCAPE '\\'
   OR action IN ('bookstack_page_create', 'asset_register')
ORDER BY id DESC
LIMIT $1
```

返形：
```json
{
  "items": [
    {
      "id": 42,
      "email": "dev@local",
      "action": "ingest_done",
      "target_type": "asset",
      "target_id": "137",
      "at": "2026-04-21T05:13:00Z",
      "name": "contract-v3.pdf",
      "chunks": 28,
      "images": 4
    }
  ]
}
```

后端从 `detail` 里挖 name / chunks / images，做轻量整形供前端渲染。

权限：`requireAuth()`，不加 ACL 门（读自己的历史不算敏感）。

## 前端

### 4 步状态机

```
files[] --(parse)--> files[].extract --(metaEdit)--> files[].metadata --(commit)--> files[].result
  step=1                  step=2                       step=3                         step=4
```

状态条件：
- step 1 可到 2：至少一个文件
- step 2 可到 3：所有选中文件都 parsed
- step 3 可到 4：用户点"提交全部"

### 数据模型（前端 state）

```ts
interface Row {
  id: string            // UUID 前端生成
  file: File
  phase: 'pending' | 'parsing' | 'parsed' | 'uploading' | 'done' | 'failed'
  extract?: { kind: 'text'; text: string; summary?: string }
           | { kind: 'attachment'; hint: string }
  tags: string[]        // 用户编辑
  category: string      // 规章/合同/技术/报表/其它
  overrideSummary?: string
  error?: string
  assetId?: number      // commit 成功后回填
  pageId?: number
}
```

### 布局

```
┌──────── 步骤条（1.选择 → 2.预览 → 3.元数据 → 4.提交）────────┐

┌──────────────┬──────────────────────┬──────────────┐
│ 队列（L）    │ 预览（M）            │ 元数据（R）  │
│ [+ 添加]     │ [选中文件的渲染]     │ tags input   │
│ row1 ●       │ 文本：markdown      │ category ▼   │
│ row2 ○       │ 附件：hint + 图标    │ summary      │
│ row3 ✓       │                      │ [应用]       │
└──────────────┴──────────────────────┴──────────────┘
┌── 底部：选中知识库 + [解析] [提交全部] [清空] ──┐

┌── Recent Imports (底部) ──┐
│ 2分钟前 · contract.pdf · 28 切片 · [详情]
│ ...
```

### 约束

- 文件加入队列立即计算 SHA256 前 8 位作为 id；防撞用 Date.now()
- 解析按钮点一次跑所有 `pending` 行（串行，内存稳）
- 提交按钮只处理 `parsed` 行，跳过 `pending`/`failed`
- 失败行保持在列表里，右下 [重试] 单行重跑
- Recent Imports 每隔 10 秒刷新（仅在非 uploading 态）；提交完成后立即刷新一次

## 组件拆分

- `knowledge/Ingest/Wizard.tsx` —— 容器（替换 index.tsx）
- `knowledge/Ingest/FileQueue.tsx` —— 左栏
- `knowledge/Ingest/PreviewPane.tsx` —— 中栏
- `knowledge/Ingest/MetaForm.tsx` —— 右栏
- `knowledge/Ingest/RecentImports.tsx` —— 底部

保留旧 ZIP 入库：独立 Tab `[向导] [ZIP 批量]`，ZIP Tab 复用旧 UI 的 mini 版本（直接嵌到新文件里）。
