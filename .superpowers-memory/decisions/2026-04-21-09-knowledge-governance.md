# ADR 2026-04-21-09 · 知识治理子模块（首份审计 + 标签 + 重复 + 质量）

## Context

PRD §9.1 + §17.5 强制要求：
- 治理子模块 4 块独立能力
- 所有写操作必须写审计

当前完全无：审计 / 标签管理 / 重复检测 / 质量评分。

## Decision

1. 新建 `audit_log` 表 + `services/audit.ts#writeAudit`；
   ingestPipeline / ACL admin 完成后**同步**调一次（不引 queue）
2. 标签合并 = `array_replace` 直接更新 `metadata_asset.tags`，不维护单独 tag 表
3. 重复检测用每个 asset 的"代表向量"（chunk_level=3 第一个 embedding）做 cosine
4. 质量评分采用固定 4 类规则（缺作者 / 缺标签 / >180 天未更新 / 内容空），不做规则编辑器
5. 重复合并 = 软标 `merged_into`；老 chunks 转给目标 asset
6. 审计日志支持 CSV 导出（PRD §13.5 要求"导出"，等价口径）

## Consequences

**正面**
- 满足 PRD §9.1 + §17.5 硬要求
- 不引依赖；纯 PG + 现有 LLM 能力
- 后续接 G2 unified-auth-permissions 后，hooks 自动走新权限模型

**负面 / 取舍**
- 重复检测 O(n²)，规模上千需要重构（postgres 自带 ANN search 可用）
- "stale 自动通知" 当前只写 audit，没接邮件 / 钉钉
- 没有标签层级 / 同义词表（按需 Phase 2）

## Links

- proposal/design/spec/tasks: `openspec/changes/knowledge-governance/`
- 触发文档：`知识中台产品需求文档 v1.0` §9.1 + §17.5
