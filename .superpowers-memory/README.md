# Superpowers Memory

本目录是 **共享项目记忆**，Claude 在每次工作流启动时会读取并尝试保持最新。
committed 到仓库，确保所有团队成员与 Claude 对齐。

## 子目录约定

- `decisions/` — 架构决策记录（ADR，编号累加，不覆盖）。
- `glossary.md` — 业务名词统一，避免同义异名。
- `open-questions.md` — 未解问题，列出卡点与等待方。
- `integrations.md` — 跨服务对接的真相源（BookStack、MySQL、pgvector 等）。

## 维护规则

1. **只追加，不覆盖**：决策以日期 + 编号的文件保存（如 `decisions/2026-04-21-01-rbac-jwt.md`）。
2. **由执行负责人写入**：谁落定的决策，谁补 ADR；Claude 在工作流末尾要提醒。
3. **冲突即升级**：发现与现有 ADR 冲突，不直接改老文件，新开一个 decision 引用旧编号。
4. **PR 标签**：修改本目录的 PR 需贴 `memory` 标签并 @ 所有人。
