# Project Workflow

These workflow instructions are explicit opt-in. Do not apply them by default.
Only use them when the user explicitly asks for the workflow or invokes its
command.

If `.superpowers-memory/` exists in the repository, treat it as shared project
memory and keep it up to date during the workflow.

---

## 四阶段流水线 — 可选择的四条工作流

基于 `superpowers-openspec-team-skills` 约定。详细规则见 `docs/workflows/README.md`，
命令定义见 `.claude/commands/*.md`。

| ID | Command | 场景 | OpenSpec | 写代码 |
|----|---------|------|----------|--------|
| A | `openspec-superpowers-workflow`           | 全新 P0、需求不清 | 有 | 有 |
| B | `superpowers-openspec-execution-workflow` | 有上游依赖的 P1   | 有 | 有 |
| C | `superpowers-feature-workflow`            | 独立 UI 细节      | 无 | 有 |
| D | `openspec-feature-workflow`               | 只产接口契约      | 有 | 无 |

### 快速选择卡

- 需求模糊 + 全新功能 + 要 OpenSpec 存档 → **A `openspec-superpowers`**
- 有依赖 + 需求清晰 + 走完四步            → **B `superpowers-openspec-execution`**
- 独立 UI + 无跨人接口 + 快速交付          → **C `superpowers-feature`**
- 只出接口定义供他人消费                   → **D `openspec-feature`**

### 启动规则

1. **每次 Claude Code 会话第一句必须写明工作流名称**，否则 AI 会直接跳进代码。
2. Explore 阶段产物不进主分支：放 `docs/superpowers/specs/` 或 PR draft 状态。
3. OpenSpec 文件合并 = 接口契约生效，下游人员可以开始消费。
4. 验证输出是完成的门槛——没有测试通过记录不能关闭任务。
5. 看板状态同步是每日强制项，完成阶段切换后当天更新 Excel。

### 安装（每人本地一次性）

```powershell
cd <project-root>

# 安装完整四阶段流水线
./scripts/install-claude-code.ps1 -Bundle superpowers-openspec-execution -ProjectRoot .

# 验证安装
./scripts/install-claude-code.ps1 -Bundle superpowers-openspec-execution -CheckDependencies
```

安装完成后会出现 `.claude/commands/` 命令文件，CLAUDE.md 也会指向它们。

---

## 目录约定

```
.claude/commands/                  四个工作流命令定义
scripts/install-claude-code.ps1    本地安装脚本
docs/workflows/README.md           面向人的完整指南（含提示词模板）
docs/superpowers/
  ├── specs/<feature>/             Explore + 设计草稿（不进主分支或 draft PR）
  ├── plans/<feature>-impl-plan.md 实现计划（可迭代）
  └── archive/<feature>/           验证通过并归档的完整 spec
openspec/changes/<feature>/        OpenSpec 锁定的行为契约（合并后冻结）
.superpowers-memory/               共享项目记忆（ADR、术语、未解问题）
```
