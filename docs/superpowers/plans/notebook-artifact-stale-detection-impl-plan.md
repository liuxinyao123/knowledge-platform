# Impl Plan · N-003 Notebook Artifact Stale Detection

> 工作流：C `superpowers-feature-workflow`
> 阶段：Plan + Implement + Verify
> spec：`docs/superpowers/specs/notebook-artifact-stale-detection-design.md`

## 已完成清单

| Task | 文件 | 改动 |
|---|---|---|
| Implement-1 | `apps/web/src/knowledge/Notebooks/StudioPanel.tsx` | Props 改 `sourceCount: number` → `sourceAssetIds: number[]`；内部 `sourceCount = sourceAssetIds.length` 兼容老用法 |
| Implement-2 | 同上 | 新增 `isArtifactStale(artifact, currentSourceAssetIds): boolean`：比较 `artifact.meta.sources_snapshot` vs 当前 sources 集合；只对 `status === 'done'` 适用；无 snapshot（V1 老数据）→ false |
| Implement-3 | 同上 | `ArtifactCard` Props 加 `stale: boolean` + `currentSourceCount: number`；内部算 `staleTooltip`（"上次生成基于 N 份；当前 M 份已变化"） |
| Implement-4 | 同上 | 状态 chip 优先级：done + stale → 黄色"已过期 ⚠️"（背景 #fef3c7 / 文字 #92400e）+ tooltip；done + 非 stale → 蓝色"已完成"；其它状态不变 |
| Implement-5 | 同上 | 重生成按钮：stale + done 时文案改"重新生成（已过期）"+ 黄色边框 + 加粗，tooltip 同上；其它状态文案不变 |
| Implement-6 | `apps/web/src/knowledge/Notebooks/Detail.tsx` | `<StudioPanel>` 调用从 `sourceCount={sources.length}` 改为 `sourceAssetIds={sources.map(s => s.asset_id)}` |
| Verify-1 | `npx tsc --noEmit -p apps/web/tsconfig.app.json` | exit 0（tsc clean）|
| DOC-1 | `docs/superpowers/specs/notebook-artifact-stale-detection-design.md` | C-1 Explore 设计 |
| DOC-2 | 本文件 | C-2 Plan + C-3 Implement 倒推 |

## 待办（C-4 Verify · 用户视觉走查）

| Task | 期望产物 | 谁做 |
|---|---|---|
| Verify-2 | 重启 web dev + 在某 notebook 内：(1) 确认 sources 没变时 artifact 显示"已完成"（蓝色）；(2) 添加 / 删除一个 source；(3) 刷新或操作触发 reload，artifact 卡片切到"已过期 ⚠️"（黄色徽标）；(4) 鼠标 hover 看到 tooltip 含数字 | user |
| Verify-3 | 点击"重新生成（已过期）"按钮 → 触发 generateArtifact → 等待 done → 卡片回到"已完成"（蓝色）| user |
| Verify-4 | 老数据兼容：DB 里 V1 老 artifact（没 meta.sources_snapshot）应当显示"已完成"不被误标 stale | user |
| Close | 看板任务标 Done（C 工作流跳过 Archive）| user |

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| 老 V1 artifact 缺 sources_snapshot 被误标 stale | `isArtifactStale` 第一道：`Array.isArray(snapshot) && snapshot.length > 0` 判空兜底 |
| sources_snapshot 字段格式异常 | `Number(s?.asset_id).filter(Number.isFinite)` defensive parsing |
| stale 推断频繁 re-render | `isArtifactStale` 是纯函数 + 输入只有 artifact + sourceAssetIds，React 重渲染开销 O(N×M) 对 8 类 artifact + 几十个 source 完全可忽略 |
| 整套 N-003 revert | 还原 StudioPanel.tsx + Detail.tsx 即可；后端零改动 |

## C 工作流 Close 说明

按 `.claude/commands/superpowers-feature-workflow.md`：
1. tsc 干净 ✅
2. 单元测试（无 UI 测试套件，跳过）
3. 视觉走查 ⏳ user 跑一次 Verify-2/3/4 即关闭

跳过 OpenSpec 归档（C 工作流约定）；任务关闭后纳入下次 PR push。

## 与 N-* 系列的协同

- **N-002 引入 meta.sources_snapshot 字段** → N-003 直接消费；零额外 schema
- **N-005 artifact 接入意图分流** → 不影响 stale 推断（snapshot 字段独立）
- **未来 C-C 自动重生成模式**（opt-in）→ 复用 isArtifactStale 函数
