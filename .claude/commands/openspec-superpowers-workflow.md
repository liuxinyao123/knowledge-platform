# Command: openspec-superpowers-workflow

> 工作流 A — 全链路：澄清 → 设计 → 规范 → 编码 → 验证
>
> 适用场景：全新 P0 功能；需求不清晰；需要 OpenSpec 存档；跨人契约。
> 看板任务举例：登录页 UI、RBAC 权限控制、知识问答。

## 启动条件

用户在 Claude Code 会话首句必须显式包含本命令名，否则 AI 会跳过澄清直接写代码。

推荐提示词模板：

```
Use $openspec-superpowers-workflow to run this feature from clarification
through verification.

Feature: <功能名>
背景：<上下文，涉及的模块、当前痛点>
需要覆盖：<核心交付物清单>
请先澄清需求边界，再输出 OpenSpec 规范，最后进入实现阶段。
```

## 五个阶段与产物

1. **Clarify（需求澄清）**
   - 通过问答确认边界、成功标准、Out of Scope。
   - 产物：`docs/superpowers/specs/<feature>/proposal.md`
2. **Explore（设计草稿）**
   - 生成技术方案候选、依赖/风险盘点、关键决策。
   - 产物：`docs/superpowers/specs/<feature>/design.md`
   - **禁止写生产代码**。
3. **Lock（OpenSpec 锁定）**
   - 把行为契约迁入 `openspec/changes/<feature>/`。
   - 产物：
     - `openspec/changes/<feature>/proposal.md`
     - `openspec/changes/<feature>/design.md`
     - `openspec/changes/<feature>/specs/<feature>-spec.md`
     - `openspec/changes/<feature>/tasks.md`
   - OpenSpec PR 合并后方可进入下一阶段。
4. **Execute（实现）**
   - 遵循 tasks.md 顺序，TDD 驱动；同步 `docs/superpowers/plans/<feature>-impl-plan.md`。
5. **Verify（验证与归档）**
   - 运行 `pnpm -r test`、`pnpm -r lint`、必要的端到端检查。
   - 完成声明必须附带新鲜的验证证据（日志/截图/测试报告）。
   - 归档：将 spec 目录移入 `docs/superpowers/archive/<feature>/`。

## 控制点

- Explore 阶段产物不进主分支；放 `docs/superpowers/specs/` 或 PR draft。
- OpenSpec 文件合并 = 接口契约生效，下游人员可以开始消费。
- 没有验证证据 → 不允许关闭任务；看板不可前移。
- 每次阶段切换后当天更新看板 Excel。

## 与其他工作流的关系

- 若需求已锁定，只有实现任务 → 改用 **B · superpowers-openspec-execution**。
- 若只需产出接口契约供他人消费 → 改用 **D · openspec-feature**。
- 若是独立 UI 小组件 → 改用 **C · superpowers-feature**（跳过 OpenSpec）。
