# Design: task-knowledge-drawer

## 后端

### POST /api/knowledge/task-context

```ts
Input: {
  taskId: string | number
  title: string
  description?: string
  limit?: number   // 默认 5
}

Output: {
  relatedAssets: Array<{
    id: number
    name: string
    type: string
    updated_at: string | null
    tags: string[] | null
    snippet: string | null   // 最佳匹配的一条 chunk 文本片段（前 240 字）
    score: number | null     // cosine 距离分数（embeddings 开启时）
  }>
  recentAudits: Array<{
    id: number
    action: string
    target_type: string | null
    target_id: string | null
    at: string
    email: string | null
    detail_excerpt: string | null
  }>
  mode: 'semantic' | 'fallback'   // fallback 时 UI 需警告
  note?: string
}
```

**查询路径（semantic 模式）**
1. `embedTexts([title + '\n' + (description ?? '')])` → 1 向量
2. pgvector 查：
   ```sql
   SELECT a.id, a.name, a.type, a.updated_at, a.tags,
          f.content, f.embedding <=> $1 AS dist
   FROM metadata_asset a
   JOIN metadata_field f ON f.asset_id = a.id
   WHERE a.merged_into IS NULL AND f.embedding IS NOT NULL
   ORDER BY dist ASC
   LIMIT $2 * 3
   ```
3. 按 asset_id dedupe，取前 `limit` 条；snippet = 最佳 chunk 的前 240 字；score = 1 - dist
4. 同时查 audit_log：
   ```sql
   SELECT id, action, target_type, target_id, created_at, principal_email, detail
   FROM audit_log
   WHERE detail::text ILIKE '%' || $1 || '%'
      OR target_id = $2
   ORDER BY id DESC LIMIT 5
   ```

**fallback 模式**（无 embeddings）
- assets 按 `indexed_at DESC` 取前 limit 条
- audits 同上（也能跑）
- 返 `mode:'fallback'` + note

权限：`requireAuth()`。不加 enforceAcl（下游各 asset 仍受本系统列表页权限管控；drawer 自身只是视图聚合）。

## 前端

### TaskKnowledgeDrawer.tsx

```tsx
interface Props {
  taskId: string | number
  title: string
  description?: string
  onClose?: () => void   // 顶栏×
  embedded?: boolean     // true 时不占 fixed 位置（给 iframe 用）
}
```

布局（右侧抽屉 360px）：
```
[📚 相关知识] [🕑 操作记录]       ×
─────────────────────
[fallback 黄条（如有）]

Tab 1 相关知识:
  ▸ name · type · 最近更新
    snippet 前 180 字
    tags...
    [打开] → /assets/:id

Tab 2 操作记录:
  ▸ 时间 · action · email
    detail_excerpt

[↻ 刷新]   task: taskId
```

embedded=true 时取消 fixed / shadow，由外部容器控制宽高。

### 接入

- 新页 `/task-demo`（KnowledgeTabs 外独立路由；DEV 顶部做入口）
- 让 UsersTab 旁边加入链接？不，drawer 是跨页组件；Demo 页就够了
- API: `api/task.ts` —— `getTaskContext(taskId, title, description?)`

## 约束

- fallback 模式在 drawer 顶部显 "📌 演示数据：后端 embeddings 未配置，按时间排序"
- relatedAssets 点卡片跳 `/assets/:id`（G5 已有详情页）
- audits 点卡片跳 `/assets/:target_id`（若 target_type === 'asset'）
