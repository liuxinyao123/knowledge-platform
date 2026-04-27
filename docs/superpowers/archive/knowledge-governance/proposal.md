# Proposal: 知识治理子模块（PRD §9.1）

## Problem

PRD §9.1 要求"知识治理"二级模块下含 4 块独立能力，目前**全无**：
- 标签体系：列出标签 + 条目数 + 7 天增长；新建 / 合并 / 重命名
- 重复检测：找高相似条目对，可调阈值；操作合并 / 标记非重复
- 质量评分：低质条目（缺作者 / 超 180 天未更新 / ...）；批量修复 / 提醒
- 审计日志：所有写操作（入库 / 合并 / 发布 / 规则变更）的记录；可导出

旁系：所有写操作目前**没有任何审计**，与 PRD §17.5"必须写入审计日志"冲突。

## Scope（本 Change）

### 后端
1. 新表 `audit_log`：`{id, ts, principal_user_id, principal_email, action, target_type, target_id, detail JSONB, source_ip}`
2. 新 service `services/audit.ts` —— `writeAudit({action, targetType, targetId, detail, principal, ip})`
3. ingestPipeline 完成时自动写一条 `action=ingest_done` 审计
4. 新路由 `routes/governance/*.ts`（沿用现有 `/api/governance` 命名空间）：
   - `GET /tags` —— 标签列表 + 用法计数 + 7 天增长
   - `POST /tags/merge` —— 合并 N 个标签到 1 个目标（更新 metadata_asset.tags）
   - `POST /tags/rename` —— 重命名标签
   - `GET /duplicates?threshold=0.85&limit=50` —— pgvector ANN 找高相似 asset 对
   - `POST /duplicates/merge` —— 合并 asset_id_a 到 asset_id_b（保留 b，把 a 的 chunks 转移）
   - `POST /duplicates/dismiss` —— 标记某对"非重复"（写入忽略表）
   - `GET /quality-issues` —— 列出质量问题分组：missing_author、stale、empty_content、no_tags
   - `POST /quality-issues/fix` —— 批量修复（回填默认 author / 重新抽 tags / 标记下线）
   - `GET /audit-log?from=&to=&action=&user_id=&limit=&offset=` —— 分页 + 过滤
   - `GET /audit-log.csv` —— 导出 CSV

### 前端
- 新页面 `/governance/knowledge`（保持原 `/governance` 兼容）；4 子 Tab 切换
- 4 个面板对应 4 块能力；空态/错误态按 PRD §17.2 三态规范
- 现有"成员管理 / 空间权限"原 Governance 页保留为另一入口；本 change 不动它

### 鉴权
- 所有 GET 走 `enforceAcl({action:'READ'})`，写操作（merge / fix）走 `enforceAcl({action:'WRITE'})`
- 兼容 Q5（permissions 升级）后会自动接 PRD §2 的 `knowledge:ops:read` / `knowledge:ops:manage`

## Out of Scope

- "评分规则可由管理员自定义" 的 UI 编辑器（Phase 2）
- 单条审计日志详情/diff 查看（Phase 2）
- 审计日志导出 PDF（CSV 即可）
- 跟 IAM 的 user 管理交叉操作（属 G4 IAM-panel change）

## 决策记录

- D-001 审计写入是同步 in-process（不引 queue）；ingestPipeline / ACL admin 完成后立刻调
- D-002 重复检测用 pgvector 向量距离（cosine）；默认阈值 0.85
- D-003 质量评分采用固定规则集（缺作者 / 缺标签 / >180 天未更新 / 内容为空），不在本 change 做规则编辑
- D-004 标签合并 = `UPDATE metadata_asset SET tags = array_replace(tags, src, dst)`；rename 同理
- D-005 重复合并：源 asset 软标记 `merged_into` 字段，metadata_field 不动；查询时按 `merged_into IS NULL` 过滤
