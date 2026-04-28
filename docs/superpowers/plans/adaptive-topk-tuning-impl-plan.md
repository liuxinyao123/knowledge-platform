# Impl Plan · adaptiveTopK 中文短查询调优（C 工作流第 2 步）

> 工作流：C `superpowers-feature-workflow`（Explore → Plan → Implement → Verify）
> 倒推说明：本 plan 在代码已实施后回补。
> Spec：`docs/superpowers/specs/adaptive-topk-tuning-design.md`

## 已完成清单

| Task | 文件 | 行/段落 |
|---|---|---|
| Implement-1 | `apps/qa-service/src/services/ragPipeline.ts` | `adaptiveTopK` 函数（拆分判断 + 中文短 K 5→8） |
| Implement-2 | `apps/qa-service/src/services/ragPipeline.ts` | `runRagPipeline` Step 1 emit reason 三元 → 四元 |
| Implement-3 | `apps/qa-service/src/services/ragPipeline.ts` | `export function adaptiveTopK` 暴露给单测 |
| Test-1 | `apps/qa-service/src/__tests__/adaptiveTopK.test.ts` | 17 vitest 用例覆盖 4 档 K + 优先级 + 边界 |
| Verify-1 | `npx tsc --noEmit -p apps/qa-service` | exit 0 / no output |
| Verify-2 | tsx smoke `/tmp/smoke_adaptive.ts`（已清理）| 16 断言全过 |
| DOC-1 | `docs/superpowers/specs/adaptive-topk-tuning-design.md` | 全文 |
| DOC-2 | 本文件 | 全文 |

## 待办

| Task | 期望产物 | 谁做 |
|---|---|---|
| Verify-3 | 实测对照：跑 case2b "什么是道？" 看 emit `⚙️ 自适应 top-K = 8（中文短查询）` 而非 `K=5` | user 跑 `bash scripts/test-ad-tuning.sh` 即可看到 |
| Close | 看板任务标 Done（C 工作流跳过 Archive） | user |

## 风险 / 回滚

| 风险 | 触发条件 | 回滚动作 |
|---|---|---|
| 中文短查询 K=8 召回噪声大 | 实测某类文档下 LLM 答案出现明显噪声 | 改回 K=5 单行 patch；下次再评估 |
| 英文缩写题分类失误 | 某些命名（如 "RESTAPI"）被误判为缩写走 K=5 | 调正则边界 |

## C 工作流 Close 说明

按 `.claude/commands/superpowers-feature-workflow.md` 第 4 步：
"单元测试 + 视觉走查（截图或 Storybook）"。

本 change 无 UI 改动，验证只需：
1. tsc 干净 ✅
2. 单元测试通过（17/17 vitest）✅
3. 实测看 emit `⚙️ 自适应 top-K = N（reason）` 行 ⏳ user 验

跳过 Archive（C 工作流约定），完成验证后直接关闭看板任务。
