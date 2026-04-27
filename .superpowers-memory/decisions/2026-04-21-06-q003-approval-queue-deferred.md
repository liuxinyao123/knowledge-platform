# ADR 2026-04-21-06 · 关闭 Q-003：审批队列暂缓，需要时复用 Mission Control 组件栈

## Context

Open Question **Q-003**：审批队列是否复用 Mission Control 组件栈？

审批功能当前**无实际业务诉求**（没看板任务、没集成点）。
Mission Control 组件栈（`apps/web/src/knowledge/Overview` 下的 MetricCard / Skeleton / TopList）
已稳定。

## Decision

**暂缓立项**，不在当前阶段单独做审批队列功能。

**触发条件**（任一满足即启动审批队列 Change）：
1. 有上游业务要求审批流（ACL 规则变更审批、资产删除审批、等）
2. Agent 层需要人工 approve 某些高风险操作（metadata_ops 写操作上线时）

**触发后路径**：
- 走工作流 **C · superpowers-feature-workflow** 或 **A · openspec-superpowers**（看复杂度）
- UI 复用 Mission Control 组件栈（MetricCard / 表格 / Skeleton）
- 后端新开 `metadata_approval` 表或复用 `metadata_acl_rule.condition` 做审批状态

## Consequences

**正面**
- 不为"未来可能的需求"提前投入
- 现在聚焦高价值 Track（A/B/C/D）

**负面 / 取舍**
- 若突然来审批需求，需要新立项；但因有 Mission Control 组件栈兜底，开发速度可控

## Links

- Mission Control 组件栈: `apps/web/src/knowledge/Overview/`
- 关闭的问题: `.superpowers-memory/open-questions.md#Q-003`
- 相关依赖: agent-orchestrator 的 metadata_ops 写操作（当前占位，未来可能触发此决策）
