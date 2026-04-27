# 四阶段流水线 · Claude Code 调用指南

> 基于 [`superpowers-openspec-team-skills`](https://github.com/SYZ-Coder/superpowers-openspec-team-skills) 项目，结合本项目看板任务定制。
>
> 本指南是面向人的操作手册，命令定义见 `.claude/commands/*.md`。

---

## 安装（一次性，每人在本地执行）

```powershell
cd <project-root>

# 安装完整四阶段流水线包
./scripts/install-claude-code.ps1 -Bundle superpowers-openspec-execution -ProjectRoot .

# 验证安装（检查 openspec CLI 是否就绪）
./scripts/install-claude-code.ps1 -Bundle superpowers-openspec-execution -CheckDependencies
```

安装完成后：
- `.claude/commands/` 会出现对应的工作流命令文件；
- `CLAUDE.md` 描述会被校验；
- 若 `.superpowers-memory/` 不存在会自动创建骨架。

---

## 工作流 A · openspec-superpowers

**场景**：全新 P0 功能，需求还不清晰，要从零走完澄清 → 设计 → 规范 → 编码 → 验证。

**看板任务举例**：登录页面 UI、RBAC 权限控制、知识问答。

**Claude Code 调用提示词**

```
Use $openspec-superpowers-workflow to run this feature from clarification through verification.

Feature: RBAC 权限控制模块
背景：系统需要区分普通用户和管理员角色，基于 JWT Token 做权限映射。
需要覆盖：角色定义、权限绑定、接口鉴权中间件、前端路由守卫。
请先澄清需求边界，再输出 OpenSpec 规范，最后进入实现阶段。
```

**产出物路径**

```
docs/superpowers/specs/rbac-design.md          ← Explore 设计草稿
openspec/changes/rbac-access-control/
  ├── proposal.md                               ← 提案
  ├── design.md                                 ← 设计决策
  ├── specs/rbac-spec.md                        ← 行为规范
  └── tasks.md                                  ← 拆解任务
docs/superpowers/plans/rbac-impl-plan.md        ← 实现计划
```

**关键控制点**

- Claude 不会在 Explore 阶段写任何生产代码。
- OpenSpec 文件 PR 合并后，才解锁 Execute 阶段。
- 完成声明必须附带新鲜的验证输出（测试通过截图 / 日志）。

---

## 工作流 B · superpowers-openspec-execution

**场景**：有上游 Spec 依赖的 P1 功能，需求已基本清晰，走固定四步：探索 → 锁定 → 执行 → 归档。

**看板任务举例**：用户管理、角色管理、Mission Control 总览、审批队列。

**Claude Code 调用提示词**

```
Use $superpowers-openspec-execution-workflow for this feature: first explore with Superpowers,
then lock the change with OpenSpec, then return to Superpowers for implementation,
testing, verification, and archive.

Feature: 用户管理模块（IAM）
前置依赖：RBAC 权限控制 OpenSpec 已合并（见 openspec/changes/rbac-access-control/）
需要实现：用户 CRUD、SSO 用户导入、与 RBAC 角色绑定。
请先读取上游 RBAC Spec，再进行探索和规范锁定。
```

**四步执行顺序**

| 步骤 | 动作 | 关键产物 |
|------|------|----------|
| 1. Superpowers Explore | 读上游 Spec，做设计草稿，列风险 | `docs/superpowers/specs/<feature>/design.md` |
| 2. OpenSpec Lock       | 落定行为契约，拆解任务         | `openspec/changes/<feature>/{proposal,design,specs/*-spec,tasks}.md` |
| 3. Superpowers Execute | 按 tasks.md 顺序实现并写测试   | 生产代码 + `docs/superpowers/plans/<feature>-impl-plan.md` |
| 4. Archive             | 验证通过后归档                 | `docs/superpowers/archive/<feature>/` |

---

## 工作流 C · superpowers-feature

**场景**：P1/P2 UI 细节、不涉及跨人接口的独立组件，不需要 OpenSpec 归档。

**看板任务举例**：开始标签切换、分类标签 chips、状态栏连接显示、专家排行榜。

**Claude Code 调用提示词**

```
Use $superpowers-feature-workflow to drive the Superpowers stages for this feature request.

Feature: 分类标签 chips 组件
所在页面：首页任务创建界面（依赖已有的 TaskInput 组件）
需要实现：文档/金融/数据分析/电商等 8 个分类标签，支持单选切换，选中态高亮。
Tech stack: React + Tailwind。
跳过 OpenSpec 归档，完成验证后直接关闭任务。
```

**产出物路径**

```
docs/superpowers/specs/chips-design.md
docs/superpowers/plans/chips-impl-plan.md
src/components/CategoryChips/
  ├── CategoryChips.tsx
  ├── CategoryChips.test.tsx
  └── index.ts
```

---

## 工作流 D · openspec-feature（纯规范，不写代码）

**场景**：需要先出接口定义供其他人使用，自己的实现还没开始。典型场景是先出 RBAC Spec 解锁下游同学。

**Claude Code 调用提示词**

```
Use $openspec-feature-workflow to create the OpenSpec change artifacts before implementation.

Feature: RBAC 权限控制接口规范
目标：输出供知识中台权限治理模块消费的接口定义。
需要包含：用户角色模型、权限枚举、鉴权中间件签名、前端路由守卫接口。
只需要产出 OpenSpec 文件，不要写实现代码。
```

---

## 快速选择卡

| 情况 | 选用 |
|------|------|
| 需求模糊 + 全新功能 + 要 OpenSpec 存档 | **A** `openspec-superpowers` |
| 有依赖 + 需求清晰 + 走完四步            | **B** `superpowers-openspec-execution` |
| 独立 UI + 无跨人接口 + 快速交付          | **C** `superpowers-feature` |
| 只出接口定义供他人消费                   | **D** `openspec-feature` |

---

## 通用注意事项

1. **每次启动 Claude Code 会话，第一句话必须写明工作流名称**，否则 AI 会直接跳进代码。
2. Explore 阶段产物不进主分支，放 `docs/superpowers/specs/` 或 PR draft 状态。
3. OpenSpec 文件合并 = 接口契约生效，下游人员可以开始消费。
4. 验证输出是完成的门槛，没有测试通过记录不能关闭任务。
5. 看板状态同步是每日强制项，完成阶段切换后当天更新 Excel。
