# Command: superpowers-feature-workflow

> 工作流 C — 仅走 Superpowers 阶段；跳过 OpenSpec 归档。
>
> 适用场景：P1/P2 UI 细节、独立组件；不涉及跨人接口；需要快速交付。
> 看板任务举例：开始标签切换、分类标签 chips、状态栏连接显示、专家排行榜。

## 启动条件

- 组件边界清晰、所在页面已确定；
- 不需要产出供他人消费的契约；
- 技术栈固定（默认 React + Tailwind）。

推荐提示词模板：

```
Use $superpowers-feature-workflow to drive the Superpowers stages for this
feature request.

Feature: <组件/能力名>
所在页面：<挂载位置>（说明依赖的父组件）
需要实现：<功能清单与交互点>
Tech stack: React + Tailwind（如不同请指定）。
跳过 OpenSpec 归档，完成验证后直接关闭任务。
```

## 阶段

1. **Explore** — 输出组件设计草稿与 UI 状态矩阵 → `docs/superpowers/specs/<component>-design.md`
2. **Plan** — 列出实现步骤与测试点 → `docs/superpowers/plans/<component>-impl-plan.md`
3. **Implement** — 目录建议：
   ```
   src/components/<ComponentName>/
     ├── <ComponentName>.tsx
     ├── <ComponentName>.test.tsx
     └── index.ts
   ```
4. **Verify** — 单元测试 + 视觉走查（截图或 Storybook）。

## 控制点

- 不生成 OpenSpec 目录；若发现需要跨人契约，立即升级到工作流 A/B。
- 验证要求：组件单元测试通过；若改了公共样式，需跨页面回归截图。
- 样式严格用 Tailwind 核心工具类，保持与现有 DS Claw 规范一致。

## 与其他工作流的关系

- 若功能最终被其他模块消费 → 升级到 **A · openspec-superpowers**。
- 若能复用现有组件，优先扩展而不是新建。
