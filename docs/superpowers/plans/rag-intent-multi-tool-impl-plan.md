# Impl Plan · D-002.3 RAG 答案意图分类 multi-tool function call

> 工作流：B `superpowers-openspec-execution-workflow` · 阶段 B-3 Execute
> Spec：`openspec/changes/rag-intent-multi-tool/`（已 lock）
> Explore：`docs/superpowers/specs/rag-intent-multi-tool/design.md`

## 改动文件清单

| 文件 | 改动 | 行数变化 |
|---|---|---|
| `apps/qa-service/src/services/answerIntent.ts` | 加 `isIntentMultiToolEnabled` / `INTENT_TOOL_PARAMS` / `INTENT_TOOLS`(×5) / `TOOL_NAME_TO_INTENT` / `buildClassifyPromptMultiTool`；改 `classifyAnswerIntent` 加 dispatch；拆 `classifyAnswerIntentMultiTool` / `classifyAnswerIntentLegacy`；保留旧 `CLASSIFY_TOOL` + `buildClassifyPrompt` 不动 | +180 |
| `apps/qa-service/src/__tests__/answerIntent.test.ts` | 重组 describe 块；新增 `isIntentMultiToolEnabled` / `INTENT_TOOLS` 结构测；拆 `classifyAnswerIntent · multi-tool` (16 case) + `classifyAnswerIntent · legacy` (7 case) | +180 (整体替换) |
| `docs/superpowers/specs/rag-intent-multi-tool/design.md` | Explore 草稿（B-1 已写） | 新文件 |
| `openspec/changes/rag-intent-multi-tool/{proposal,design,specs/answer-intent-multi-tool-spec,tasks}.md` | OpenSpec 锁定（B-2 已写） | 新文件 4 个 |
| `docs/superpowers/plans/rag-intent-multi-tool-impl-plan.md` | 本文件 | 新文件 |

## 实施顺序（实际执行）

1. **守卫 + 常量先落地**（不影响 runtime）：`isIntentMultiToolEnabled` / `INTENT_TOOL_PARAMS` / `INTENT_TOOLS` / `TOOL_NAME_TO_INTENT` 在 `answerIntent.ts` 顶部就位
2. **buildClassifyPromptMultiTool 写好**（不被任何函数调用，安全 dead code）
3. **classifyAnswerIntent dispatch 切换**：拆 multi-tool / legacy 两个子函数；env 默认 on 走 multi-tool
4. **测试整体重组**：保留所有规则前置 / env 守卫 / FAIL 类的旧测；改 mock 形状从 `classify_answer_intent` enum payload → `select_*` toolName payload；新增 7 case 覆盖 multi-tool 兜底链
5. **tsc 类型检查**：exit 0
6. **vitest 跑测试**：（用户在 macOS 跑——本沙箱 Linux x64 与 macOS darwin-arm64 的 rollup 二进制不兼容）

## 接口契约 vs 实现一致性自检

| Spec 要求 | 实现位置 | 一致 |
|---|---|---|
| `isIntentMultiToolEnabled` 默认 on，识别 false/0/off/no | `answerIntent.ts:139-142` | ✓ |
| `INTENT_TOOLS` 长度 5，每个 reason 单字段 | `answerIntent.ts:155-203` | ✓ |
| 5 tool name = `select_<intent>` | `answerIntent.ts:158/166/174/182/190` | ✓ |
| 每 tool description ≤ 250（实测 ≤ 175） | 5 desc 长度：119/166/116/175/157 | ✓ |
| `TOOL_NAME_TO_INTENT` 5 项映射 | `answerIntent.ts:206-212` | ✓ |
| classifyAnswerIntent 控制流 6 步 | `answerIntent.ts:` `classifyAnswerIntent` body | ✓ |
| multi-tool: tool_choice='required' | `classifyAnswerIntentMultiTool` 内 `toolChoice: 'required'` | ✓ |
| 兜底：unknown tool / 多 tool / args 解析失败 / 0 tool | 同上函数 | ✓ |
| legacy: tools=[CLASSIFY_TOOL], toolChoice={type:function,name:classify_answer_intent} | `classifyAnswerIntentLegacy` | ✓ |
| 1.5s 硬超时（AbortController + setTimeout 1500） | 两路径共有 | ✓（仍为 pre-existing 软超时模式，不传 signal） |
| `isObviousLanguageOp` 规则前置不动 | `classifyAnswerIntent` 第 4 步 | ✓ |
| maxTokens=80, temperature=0.1 | 两路径共有 | ✓ |

## 兜底链时序（multi-tool 路径）

```
chatComplete 抛异常
  → catch { intent: factual_lookup, fallback: true, reason: 'classify failed: <err>' }

返回 toolCalls: undefined / [] 
  → { intent: factual_lookup, fallback: true, reason: 'no tool call returned' }

toolCalls[0].function.name 不在 TOOL_NAME_TO_INTENT
  → { intent: factual_lookup, fallback: true, reason: 'unknown tool: <name>' }

toolCalls[0].function.name 合法
  ├── args 解析合法 + reason 合法字符串
  │     → { intent, fallback: false, reason: <args.reason 截断到 60 字> }
  ├── args 解析失败（malformed JSON）
  │     → { intent, fallback: false, reason: '<toolName> args parse failed' }
  └── + toolCalls.length > 1
        → reason 追加 '; multi-tool, took first'
```

## 旧/新 mock 形状对照表（测试改造）

| 测试场景 | 旧 mock（baseline 7） | 新 mock（D-002.3） |
|---|---|---|
| LLM 返回 factual_lookup | `{name:'classify_answer_intent', args:'{"intent":"factual_lookup","reason":"x"}'}` | `{name:'select_factual_lookup', args:'{"reason":"x"}'}` |
| LLM 返回 language_op | `{name:'classify_answer_intent', args:'{"intent":"language_op","reason":"x"}'}` | `{name:'select_language_op', args:'{"reason":"x"}'}` |
| 非法 intent | `{name:'classify_answer_intent', args:'{"intent":"foo",...}'}` | `{name:'select_does_not_exist', args:'...'}` |
| args 解析失败 | （旧路径 args 失败必降级，没有此 case） | `{name:'select_kb_meta', args:'malformed{'}`，仍接受 intent |
| 多 tool | （旧 toolChoice 强制 1 个，不会发生） | `[{name:'select_kb_meta',...},{name:'select_language_op',...}]`，取首 |

## 已知限制（不是本特性 bug）

1. **AbortController 软超时**：`setTimeout(() => ctrl.abort(), 1500)` 但 `chatComplete` 不接 `signal: ctrl.signal`——pre-existing 行为，本特性沿用，不在范围。
2. **vitest 在 Linux 沙箱跑不起来**：rollup 二进制平台不匹配（macOS 设的 darwin-arm64，沙箱 Linux x64）；用户在 macOS 验证。
3. **fast LLM (Qwen2.5-7B) 在 5-tool selection 上的稳定性**：本特性 expected hypothesis，需 V-2/V-3 实测验证。eval 跑 3 次取众数兜底。

## V-2/V-3 验证脚本（用户在 macOS）

```bash
cd ~/Git/knowledge-platform

# 1. tsc + vitest
pnpm -F qa-service exec tsc --noEmit -p .
pnpm -F qa-service test src/__tests__/answerIntent.test.ts

# 2. 重启 qa-service（INTENT_MULTI_TOOL_ENABLED 默认 on）
pkill -f 'qa-service' || true
pnpm -F qa-service dev &

# 3. eval 全集（intent 期望 14/14，must_pass 期望 5/5）
node scripts/eval-multidoc.mjs

# 4. V3E 单 case 跑 3 次（期望 ≥2 次返回 out_of_scope）
for i in 1 2 3; do
  node scripts/eval-multidoc.mjs --case D003-V3E
done

# 5. 回滚验证：env=off 应该完全等同 baseline 7
INTENT_MULTI_TOOL_ENABLED=false node scripts/eval-multidoc.mjs
```

## 完成判据

- [x] tsc 零 error（已 in-sandbox 验证）
- [ ] vitest 全过（≥ 23 case，含 isIntentMultiToolEnabled/INTENT_TOOLS 结构测 + multi-tool 16 case + legacy 7 case）—— **待 macOS 验证**
- [ ] eval intent 14/14、must_pass 5/5 —— **待 macOS 验证**
- [ ] V3E 三跑 ≥2 次 oos —— **待 macOS 验证**
- [ ] env=false 重跑 → 行为等同 baseline 7 —— **待 macOS 验证**
