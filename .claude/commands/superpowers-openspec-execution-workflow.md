# Command: superpowers-openspec-execution-workflow

> 工作流 B — 固定四步：探索 → 锁定 → 执行 → 归档
>
> 适用场景：P1 功能；有上游 Spec 依赖；需求已基本清晰；走固定四步。
> 看板任务举例：用户管理（IAM）、角色管理、Mission Control 总览、审批队列。

## 启动条件

- 已存在可读取的上游 OpenSpec（`openspec/changes/<upstream>/`）；
- 当前功能的 proposal 基本明确（Problem / Scope / Out of Scope 可口述）。

推荐提示词模板：

```
Use $superpowers-openspec-execution-workflow for this feature: first explore
with Superpowers, then lock the change with OpenSpec, then return to
Superpowers for implementation, testing, verification, and archive.

Feature: <功能名>
前置依赖：<上游 change 目录>
需要实现：<核心交付物>
请先读取上游 Spec，再进行探索和规范锁定。
```

## 四步执行顺序

| 步骤 | 动作 | 关键产物 |
|------|------|----------|
| 1. Superpowers Explore | 读上游 Spec，做设计草稿，列风险 | `docs/superpowers/specs/<feature>/design.md` |
| 2. OpenSpec Lock | 落定行为契约，拆解任务 | `openspec/changes/<feature>/{proposal,design,specs/*-spec,tasks}.md` |
| 3. Superpowers Execute | 按 tasks.md 顺序实现并写测试 | 生产代码 + `docs/superpowers/plans/<feature>-impl-plan.md` |
| 4. Archive | 验证通过后归档 | 将 `docs/superpowers/specs/<feature>/` 移入 `docs/superpowers/archive/<feature>/` |

## 控制点

- **上游缺失不得开工**：若依赖的 OpenSpec 未合并，暂停并通知上游负责人。
- **Lock 阶段 freeze**：OpenSpec 合并后才能 Execute；锁定期若需改，回到工作流 A 提 change request。
- **验证必产出日志**：`pnpm -r test` 通过记录、关键接口 cURL / Postman 截图、前端关键流程截图。
- 归档后在看板把阶段标记为 Done，更新负责人的周报。

## 与其他工作流的关系

- 如果上游尚未出 Spec，应先让上游方执行 **D · openspec-feature**。
- 如果此任务不需要跨人契约（仅 UI 细节）→ 回退到 **C · superpowers-feature**。
