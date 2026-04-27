# Command: openspec-feature-workflow

> 工作流 D — 仅产出 OpenSpec 契约；不写任何实现代码。
>
> 适用场景：先提供接口定义供他人消费；自己实现尚未开始。
> 典型场景：上游负责人（如 RBAC Spec）先出 Spec 解锁下游同学。

## 启动条件

- 任务角色是"契约提供方"；
- 下游至少有一个等待该契约的任务挂起。

推荐提示词模板：

```
Use $openspec-feature-workflow to create the OpenSpec change artifacts
before implementation.

Feature: <功能名> 接口规范
目标：<要解锁哪些下游任务>
需要包含：<数据模型、接口签名、错误码、校验规则>
只需要产出 OpenSpec 文件，不要写实现代码。
```

## 产物

只产出以下文件，**绝对不要写生产代码**：

```
openspec/changes/<feature>/
  ├── proposal.md       Problem / Scope / Out of Scope / 决策记录
  ├── design.md         数据模型、API 契约、时序、异常路径
  ├── specs/
  │   └── <feature>-spec.md   BDD / Given-When-Then 行为描述
  └── tasks.md          下游可并行消费的任务拆解（标注 owner）
```

## 控制点

- **不写实现代码**：AI 若开始改 `apps/` 下任何文件，应立即中断并回到 Spec。
- **可消费即合并**：PR 评审通过 = 契约生效；下游用 `@spec:<feature>` 标注依赖关系。
- **变更管理**：合并后如需改动，走新的 change 而不是原地覆盖。

## 与其他工作流的关系

- 出完 Spec 后，自己的实现走 **B · superpowers-openspec-execution**。
- 下游消费方引用本 Spec 时，也走 **B**。
