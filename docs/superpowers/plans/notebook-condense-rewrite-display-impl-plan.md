# Impl Plan · N-004 Notebook Condense Rewrite Display

> 工作流：C `superpowers-feature-workflow`
> 阶段：Plan + Implement + Verify
> spec：`docs/superpowers/specs/notebook-condense-rewrite-display-design.md`

## 已完成清单

| Task | 文件 | 改动 |
|---|---|---|
| Implement-1 | `apps/web/src/components/RewriteBadge.tsx`（新建） | `extractCondenseRewrite(steps)`：从 ragSteps 找 icon='🪄' 项 + 正则解析 label `「X」→「Y」`；`<RewriteBadge from to>` 蓝色徽标组件 + tooltip |
| Implement-2 | `apps/web/src/knowledge/Notebooks/ChatPanel.tsx` | InflightBubble 三态（thinking / streaming / done / error）都在 Bubble 上方渲染 RewriteBadge；之前 streaming/done 时 ragSteps 不渲染 → 改写痕迹丢失 bug 顺便修了 |
| Implement-3 | `apps/web/src/knowledge/QA/index.tsx` | assistant bubble 顶部加 RewriteBadge（任何 bubbleState 都显示，只要 ragSteps 含 🪄）|
| Verify-1 | `npx tsc --noEmit -p apps/web/tsconfig.app.json` | exit 0（tsc clean）|
| DOC-1 | `docs/superpowers/specs/notebook-condense-rewrite-display-design.md` | C-1 Explore + C-2 Plan |
| DOC-2 | 本文件 | C-3 Implement 倒推 |

## 待办（C-4 Verify · 用户视觉走查）

| Case | 期望 |
|---|---|
| Notebook 内问 "那你把原文发我"（接道德经 history） | 助手气泡上方蓝色徽标 "🪄 「那你把原文发我」→「...改写后...」" |
| 全局 QA 同 case | 同上 |
| 短问题 + history 空（"什么是道？"）| 不显示徽标（condense 不触发） |
| 鼠标 hover 徽标 | 看到 tooltip 含 "fast LLM 把你的问题改写成自洽问句" |
| 跑 `bash scripts/test-ad-tuning.sh` 后看 case1a SSE | 确认 emit `🪄` 且前端 ChatPanel/QA 能渲染 |

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| ragSteps 没 🪄 / label 异常 | extractCondenseRewrite 返回 null → 徽标不渲染（silent fail）|
| label 正则改动 | 当前 label 由后端 `services/condenseQuestion.ts:118` emit，正则匹配 `「([^」]+)」\s*→\s*「([^」]+)」` 容错足够 |
| 整套 N-004 revert | 还原 ChatPanel + QA + 删 RewriteBadge.tsx；后端零依赖 |

## C 工作流 Close 说明

按 C 工作流约定：
1. tsc 干净 ✅
2. 单元测试（无 UI 测试套件，跳过）
3. 视觉走查 ⏳ user 跑一次

完成后跳过 OpenSpec 归档，纳入下次 PR push。

## 与 N-* 系列协同

- **N-001 notebook 接入档 B**：notebook 内 condense 也触发，徽标自动可见
- **N-003 stale**：跟 N-004 完全独立（一个看 sources_snapshot，一个看 ragSteps）
- **未来 D-002.x function tool**：若引入新 SSE icon 标识（如 🛠️ "调用了翻译工具"），可复用 RewriteBadge 模式做轻量徽标
