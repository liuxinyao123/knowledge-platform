# Explore Draft — 知识治理子模块

> 草稿。正式契约见 `openspec/changes/knowledge-governance/`。

## 读的代码

- PRD §9.1 列了 4 块：标签体系 / 重复检测 / 质量评分 / 审计日志
- 现有 `metadata_asset.tags` 已有（ingest 阶段通过 extractTags 写入）
- ACL / ingestPipeline / Governance 现已稳定，可接 audit hook
- 无任何现成的审计、去重、质量评分能力

## 候选方案评估

| 方案 | 代价 | 风险 | 评分 |
|------|------|------|------|
| A 全部 UI-only 占位 | 低 | 价值有限 | ✗ |
| B 后端 + UI 完整闭环（本 change 采用） | 中 | 重复检测 O(n²) 初期能接受 | ✓ |
| C 引入专用工具（如 OpenMetadata） | 高 | 依赖膨胀 | ✗ |

**选 B**：独立、价值明确、能支撑 PRD §17.5 强制的审计要求。

## 风险

- 重复检测规模 > 1000 asset 时 O(n²) 代价显著；需要后续批量化
- stale 只发审计不改 asset，需前端明确"不是自动下线"
