# Impl Plan · D-002.6 factual_lookup 拒答倾向修复

## 改动文件

| 文件 | 改动 |
|---|---|
| `apps/qa-service/src/services/answerPrompts.ts` | 加 `isFactualStrictVerbatimEnabled()`；`buildFactualLookupPrompt` 第 1 条规则按 env 分支 |
| `apps/qa-service/src/__tests__/answerPrompts.test.ts` | 加 D-002.6 测试 block：env 守卫 3 case + buildFactualLookupPrompt 5 case (FL-1..FL-5) |

## 验收 (V-2)

```bash
cd ~/Git/knowledge-platform
pnpm -F qa-service exec tsc --noEmit -p .
pnpm -F qa-service test src/__tests__/answerPrompts.test.ts
pnpm -F qa-service test     # 整套零回归

pkill -f 'qa-service' || true
pnpm -F qa-service dev &
sleep 3

# sop-数值 单 case N=3 (核心目标)
node scripts/eval-multidoc.mjs --case D003-sop-数值 --repeat 3 --verbose

# industrial_sop_en 全集回归
node scripts/eval-multidoc.mjs --doc-type industrial_sop_en --repeat 3

# 全集 N=3
node scripts/eval-multidoc.mjs --repeat 3

# 回滚
FACTUAL_STRICT_VERBATIM_ENABLED=false node scripts/eval-multidoc.mjs --case D003-sop-数值 --repeat 3
```

期望:
- sop-数值 keywords 1/3 → ≥ 2/3 命中 alpha + beta
- V3C / V3B / sop-中英 不回归
- env=false 重跑 → 1/3（守卫工作）
