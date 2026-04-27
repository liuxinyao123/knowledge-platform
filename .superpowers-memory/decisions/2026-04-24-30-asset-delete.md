# ADR-30 · 2026-04-24 · 资产删除能力

> 工作流：C（superpowers-feature · 单点功能补全）
> 触发：用户反馈 "没有删除功能" —— 上传了 0 切片的坏资产后无路径清理。
> 影响文件：
>   - `apps/qa-service/src/routes/knowledgeDocs.ts`（DELETE 端点加固）
>   - `apps/web/src/api/assetDirectory.ts`（新增 `deleteAsset()`）
>   - `apps/web/src/knowledge/Assets/Detail.tsx`（顶栏「🗑 删除资产」按钮）
>   - `apps/web/src/knowledge/Assets/index.tsx`（列表卡片「🗑」行内按钮）

## 背景

原 `DELETE /api/knowledge/documents/:id` 只写了 4 行 SQL，**没有鉴权、没有审计、没有磁盘清理**，而且前端根本没有任何 UI 路径调用它。用户看到 0 切片的老资产只能去 DB 手删，体验完全断掉。

## 决策

### D-001 · 端点加固（后端）

在现有路由基础上增加四层：

1. **鉴权**：`requireAuth()` + `enforceAcl({ action: 'DELETE', resourceExtractor: async (req) => ({ source_id: <从 asset 查 source_id>}) })`
   - `resourceExtractor` 异步查 `metadata_asset.source_id`，用 source 级 ACL 判权
   - 如果 asset 不存在，`resourceExtractor` 返空对象，ACL 放行，主逻辑再返 404
2. **预查询**：取 `name` + `source_id`，用于审计 detail 和错误消息
3. **主删除**：`DELETE FROM metadata_asset` —— `metadata_field` / `metadata_asset_image` 通过 FK `ON DELETE CASCADE` 级联（`pgDb.ts` L57、L74 已配）
4. **磁盘清理**：`rm -rf infra/asset_images/{assetId}/`，best-effort，失败只 WARN 不阻塞
5. **审计**：`writeAudit({ action: 'asset_delete', targetType: 'asset', targetId, detail: { name, sourceId } })`
6. **响应**：`{ ok: true, deleted: { id, name } }`

### D-002 · 前端 UI（两处入口）

- **Asset 详情页顶栏**（`Detail.tsx`）：`🗑 删除资产` 按钮
  - `RequirePermission name="iam:manage"` 包裹，普通用户看不见
  - 红字红边，视觉上区别于「权限设置」等常规按钮
  - `window.confirm` 二次确认，给出切片数 / 图片数 / 不可恢复提示
  - 删除成功后 `navigate('/assets')` 返回列表
  - 错误用 `window.alert` 弹提示 + 复位 `deleting` 状态

- **Asset 列表卡片**（`index.tsx`）：每张卡片右上角 `🗑` 小按钮
  - 同样 `RequirePermission` 包裹
  - `e.stopPropagation()` 防止触发卡片 `onClick` 跳转
  - 删除成功后乐观更新 `items`（过滤掉该 id），不等重新拉列表

### D-003 · 不做的事

- **回收站 / 软删** → 不做。V1 保持硬删简单性；若后续有需求，可用 ADR 补 `metadata_asset.deleted_at` 列
- **批量删除** → 不做。V1 单条删足够治理 0-切片 坏资产的场景
- **BookStack 源资产删除到 BookStack** → 不做。`metadata_asset` 删除只影响向量索引，不回写 BookStack；Wiki 页面本身由 BookStack 管
- **kg_db 图谱清理** → 不做（V1）。AGE 里的 Asset 节点会悬挂；下一轮 `kg-cleanup` change 统一处理

## 未来扩展位

- `/api/knowledge/documents/bulk-delete`（批量）—— 如果治理面板需要
- 软删除列 + 恢复 UI —— 审计要求严的客户
- 删除前"正在被哪些 Notebook 引用"提示 —— 防误删

## 验证闸门

| 闸门 | 结果 |
|---|---|
| qa-service `tsc --noEmit` | ✅ EXIT=0 |
| web `tsc --noEmit` | ✅ EXIT=0 |
| 单测 | ⏸ 本轮未新增（E2E 场景比较依赖实际 DB，可用户本机验证） |

## 验证步骤（用户本机）

1. **必须先重启 qa-service**：`pnpm dev:restart`（没重启的话之前的 DELETE 还没鉴权，新的 UI 调用会 404 或 403）
2. 刷新前端页面
3. 进 `/assets` 列表：右上角小 `🗑` 按钮应该出现（iam:manage 权限下）
4. 点击 → 二次确认 → 列表项消失
5. 或者进某个 asset 详情页：顶栏 `🗑 删除资产` 红色按钮
6. 删除后回到列表页确认

## 相关

- 前置：ADR-28（xlsx ingest 根治，留下 0 切片坏资产）
- 前置：permissions-v2（ADR-17）提供的 DELETE action + ACL 规则结构
- 后续可接：`kg-cleanup`、`recycle-bin`
