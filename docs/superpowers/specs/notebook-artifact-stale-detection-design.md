# Explore + Spec · Notebook Artifact Stale Detection（N-003）

> 工作流：C `superpowers-feature-workflow`（Explore → Plan → Implement → Verify · 跳 OpenSpec 归档）
> 上游依赖：N-002 notebook-artifact-types-expansion（已 B-3 · meta.sources_snapshot 已写入）
> 性质：纯前端 UI 推断；零后端 / DB 改动

## 背景 + 问题

Notebook 用户在某个 notebook 内：
1. 添加 sources A, B, C
2. 触发生成 briefing → artifact 完成
3. 后续添加 source D / 删除 source A
4. **此时 briefing 仍显示"已完成"，但内容只反映了原 A/B/C 的 sources，跟当前不一致**——用户看不到这一点，可能错信了过期信息

当前 StudioPanel 的 ArtifactCard 只显示 `状态：已完成 / 失败 / 生成中`，没有 staleness 概念。

## 设计候选 (3 选 1)

| 方案 | 描述 | 评估 |
|---|---|---|
| **C-A 后端加 stale boolean 列**：notebook_artifact 加字段，sources 变更时后端 UPDATE | DB schema 变更 + 加 trigger / hook | 重，需要 migration |
| **C-B 前端推断**（选中）：N-002 已经把 `sources_snapshot` 写入 artifact.meta；前端比对 snapshot vs 当前 sources，UI 渲染 stale 徽标 | 0 后端改动；信息已经齐全 | **优**：最小侵入；用户可见即时反馈 |
| **C-C 自动重生成**：sources 变更后 trigger 后端重生成所有 stale artifact | 用户没显式同意就花 LLM token + 不一定要的内容 | 浪费 + 用户失控 |

**结论**：走 C-B。用户看到"已过期"徽标后**自己**点重生成才执行（保留控制权 + 节省成本）。
后续 N-004 / N-005 落地后可考虑 C-C 模式做 opt-in 自动化。

## isStale 推断算法

```ts
function isArtifactStale(
  artifact: NotebookArtifact,
  currentSourceAssetIds: number[],
): boolean {
  const snapshot = (artifact.meta?.sources_snapshot ?? []) as Array<{ asset_id: number }>
  const snapshotIds = new Set(snapshot.map((s) => s.asset_id))
  const currentIds = new Set(currentSourceAssetIds)
  // 任一集合差异 → stale
  if (snapshotIds.size !== currentIds.size) return true
  for (const id of snapshotIds) if (!currentIds.has(id)) return true
  return false
}
```

边界：
- artifact 缺 meta.sources_snapshot（V1 老数据）→ 推断 false（不显示 stale，避免误报老数据）
- 状态非 done（pending/running/failed）→ 不显示 stale（这些状态不该有"过期"语义）
- artifact 还没生成（latest=undefined）→ 同上

## UI 设计

ArtifactCard 现有状态 chip：`未生成 / 生成中 / 已完成 / 失败`。

N-003 加一档：`已过期`（黄色徽标 + 工具提示 "sources 已变更，建议重新生成"）。

```
┌────────────────────────────────────┐
│ 📋 简报                            │
│   一份结构化总结：核心论点 / ...   │
│ [已过期⚠️] [重新生成（已过期）] [展开 ↓] │← N-003 改动
└────────────────────────────────────┘
```

- 状态 chip 从 "已完成" 切到 "已过期⚠️"（黄色背景 #fef3c7 + 文字 #92400e）
- 鼠标 hover 显示 tooltip："上次生成时基于 N 份资料，当前 M 份已变化"
- "重新生成" 按钮文案改成 "重新生成（已过期）"，更醒目

## Props 改动

```ts
// 当前
interface Props {
  notebookId: number
  sourceCount: number
}

// N-003
interface Props {
  notebookId: number
  sourceAssetIds: number[]    // 替代 sourceCount，能从 .length 拿到 count + 用于 isStale
}
```

`Detail.tsx` 把 `sources` 数组提取 asset_id 传给 StudioPanel。

## 风险

| 风险 | 缓解 |
|---|---|
| 老 V1 artifact 数据没 sources_snapshot | 推断 false，无误报 |
| sources 添加但内容相同（重复 asset_id 不该触发 stale）| set 比较已经处理 |
| 前后端 sources_snapshot 字段格式不一致 | TS 类型 + defensive parsing；不存在或非数组直接当空集 |
| 重生成会消耗 LLM token | 用户**手动**触发（按钮点击），有控制权 |

## Out of Scope

- 自动重生成（C-C）→ 后续单独 change
- 部分 stale 通知（"添加了某 asset 后 briefing 多了 X 信息"）→ 需要 diff，复杂
- artifact 历史版本对比 → 后续

## C 工作流四阶段进展

- **C-1 Explore** ✓（本文档）
- **C-2 Plan** → 见 `docs/superpowers/plans/notebook-artifact-stale-detection-impl-plan.md`
- **C-3 Implement** → 改 StudioPanel.tsx + Detail.tsx
- **C-4 Verify** → tsc + 视觉走查（用户在 macOS 跑）
