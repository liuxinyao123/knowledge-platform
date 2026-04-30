# Impl Plan · D-002.5 kbMetaHandler 语义筛 V3D 修复（方案 B · prompt + 代码兜底）

> 工作流：C `superpowers-feature-workflow` · 阶段 Plan
> Explore：`docs/superpowers/specs/rag-kb-meta-semantic-filter-fix-design.md`（方案 B 已选）

## 目标

把 D-002.4 揭示的 V3D 「找一下汽车工程相关的资料」keyword `LFTGATE` 0/3 修复至 ≥ 2/3 命中。手段：改 `renderKbMetaAnswer` 的 LLM 语义筛 prompt + 加代码端最低数补齐。

## 改动文件清单

| 文件 | 改动 | 估行 |
|---|---|---|
| `apps/qa-service/src/services/kbMetaHandler.ts` | `renderKbMetaAnswer` `> 10` 分支：prompt 改善 + 解析后 `< 3 条` 兜底补齐 | +30 / -10 |
| `apps/qa-service/src/__tests__/kbMetaHandler.test.ts` | 新增 1 case：「LLM 只挑 1 条 → 代码兜底补齐 ≥ 3 条」；保留所有旧 case | +20 |
| `docs/superpowers/specs/rag-kb-meta-semantic-filter-fix-design.md` | （Explore，已写）| 0 |
| `docs/superpowers/plans/rag-kb-meta-semantic-filter-fix-impl-plan.md` | 本文件 | 0 |

## 测试兼容性约束

旧测 `> 10 候选 + LLM 说全无关 (输出 "0") → 拒答` 显式断言 `LLM=0 → emptyAnswer("似乎没有")`。

**保留契约**：
- `LLM 输出 "0"`（明确说全无关）→ 仍走 `emptyAnswer`
- `LLM 输出空 / 无数字 / 解析失败` → 仍走 `fallbackMarkdownList(question, candidates)` 即前 8 条
- `LLM 抛异常` → 退化前 8 条（catch 块不变）

**新增契约**：
- `LLM picks 1~2 条`（非 0、非空）→ 接受 LLM 的选项 + 用 candidates 顺序补齐到 ≥ 3 条；`fallback=true` 标识在 trace 里（可选）

## 实施步骤（按顺序，每步 ≤ 8 分钟）

### Step 1 · 改 prompt（kbMetaHandler.ts:239-246）

```ts
const prompt = `用户问：${question}

下面是知识库内的候选文档（按入库时间倒序，最多 30 条）。

判定要点：
1. 候选名常含**领域专业术语缩写或代号**（如 LFTGATE = 尾门、BP = 业务流程、SOP = 操作规程、PRD = 产品需求文档、API = 接口、SDK = 开发包）。即便缩写陌生，名称里出现的中英文关键词都可能是子领域信号——倾向于把它纳入。
2. 请挑出**与问题语义相关的 3-8 条**（按相关性倒序）。
3. 只有候选**毫不相关**时才输出 "0"；只要至少一条沾边，必须输出该候选的编号。

候选：
${idx}

只输出数字（逗号分隔），不解释。`
```

**Diff 要点**：
- 加"判定要点"段，注入领域术语缩写 hint
- "最多 8 条" → "**3-8 条**"（设下界）
- "都不相关 → 0" → "**毫不相关**才输出 0；只要 1 条沾边必须输出"（弱化 escape）

### Step 2 · 解析后加最低数补齐（kbMetaHandler.ts:254-260）

```ts
const nums = String(content || '').match(/\d+/g)?.map(Number).filter((n) => n >= 1 && n <= candidates.length) ?? []

// LLM 明确说全无关（输出 "0" 这一个数字）→ 保留旧契约：emptyAnswer
// 注：parseNums 时已过滤 n >= 1，所以"0"会被滤掉，nums.length=0
// 区分 "0 / 空 / 无解析"：原文是否含 "0"
if (nums.length === 0) {
  const trimmed = String(content || '').trim()
  if (trimmed === '0') {
    return emptyAnswer(question)
  }
  // 非 "0" 但解析空（LLM 抖了 / 输出错乱）→ 退化前 8 条
  return fallbackMarkdownList(question, candidates)
}

// LLM 选了 1-2 条 → 接受选项 + candidates 顺序补齐到 ≥ 3
let picked = [...new Set(nums)].slice(0, 8).map((i) => candidates[i - 1]).filter(Boolean)
if (picked.length < 3 && candidates.length >= 3) {
  const usedIds = new Set(picked.map((p) => p.id))
  for (const c of candidates) {
    if (!usedIds.has(c.id)) {
      picked.push(c)
      usedIds.add(c.id)
    }
    if (picked.length >= 3) break
  }
}
return fallbackMarkdownList(question, picked)
```

**Diff 要点**：
- `nums.length === 0` 拆两支：原文 == "0" → emptyAnswer（保旧契约）；其它 → 退化前 8 条
- LLM picks 后加 `picked.length < 3` 补齐逻辑（V3D 修复路径）

### Step 3 · 加新测 case

追加到 `kbMetaHandler.test.ts` 的 `describe('renderKbMetaAnswer', ...)` 块尾：

```ts
it('> 10 候选 + LLM 只挑 1 条 → 代码兜底补齐到 ≥ 3 条（V3D 修复）', async () => {
  mockChatComplete.mockResolvedValueOnce({ content: '4', toolCalls: [] })
  const cands = Array.from({ length: 15 }, (_, i) => fakeRow(i + 1, `doc${i + 1}.pdf`))
  const out = await renderKbMetaAnswer({
    question: '汽车工程相关的资料',
    candidates: cands,
    signal: new AbortController().signal,
  })
  // LLM 选了 doc4，加上 candidates 顺序补 doc1, doc2 → 共 3 条
  expect(out).toContain('doc4.pdf')
  expect(out).toContain('doc1.pdf')
  expect(out).toContain('doc2.pdf')
  // 没溢出到 doc5
  expect(out).not.toContain('doc5.pdf')
  // 不应触发 emptyAnswer
  expect(out).not.toContain('似乎没有')
})

it('> 10 候选 + LLM 选 2 条（含 doc1）→ 仅补齐 1 条且不重复 doc1', async () => {
  mockChatComplete.mockResolvedValueOnce({ content: '1, 5', toolCalls: [] })
  const cands = Array.from({ length: 15 }, (_, i) => fakeRow(i + 1, `doc${i + 1}.pdf`))
  const out = await renderKbMetaAnswer({
    question: 'X', candidates: cands, signal: new AbortController().signal,
  })
  // LLM 选了 doc1, doc5 → picked=[1,5]；补 doc2（顺序里 1 已用，所以下一个是 2）→ [1, 5, 2]
  expect(out).toContain('doc1.pdf')
  expect(out).toContain('doc5.pdf')
  expect(out).toContain('doc2.pdf')
  // doc1 应该只出现一次（断言去重）
  expect((out.match(/doc1\.pdf/g) || []).length).toBe(1)
})

it('> 10 候选 + LLM 输出乱码 → 退化前 8 条（不走 emptyAnswer）', async () => {
  mockChatComplete.mockResolvedValueOnce({ content: 'asdjkl 不是数字', toolCalls: [] })
  const cands = Array.from({ length: 15 }, (_, i) => fakeRow(i + 1, `doc${i + 1}.pdf`))
  const out = await renderKbMetaAnswer({
    question: 'X', candidates: cands, signal: new AbortController().signal,
  })
  expect(out).not.toContain('似乎没有')
  expect(out).toContain('doc1.pdf')
})
```

旧测 `LLM 说全无关 → 拒答` 仍过：`content: '0'` 在 parseNums 后 nums.length=0，trimmed=='0' → emptyAnswer。✓

### Step 4 · tsc 校验

```bash
cd apps/qa-service && npx tsc --noEmit -p .
```

期望 EXIT=0。

### Step 5 · vitest 单测全跑

```bash
pnpm -F qa-service test src/__tests__/kbMetaHandler.test.ts
pnpm -F qa-service test src/__tests__/answerIntent.test.ts  # D-002.3 回归
```

期望 0 fail。

## Verify 阶段命令（用户在 macOS）

```bash
# 1. tsc + vitest
cd ~/Git/knowledge-platform
pnpm -F qa-service exec tsc --noEmit -p .
pnpm -F qa-service test

# 2. 重启 qa-service
pkill -f 'qa-service' || true
pnpm -F qa-service dev &
sleep 3

# 3. V3D 单 case N=3 重跑（D-002.5 修复目标）
node scripts/eval-multidoc.mjs --case D003-V3D --repeat 3 --verbose

# 4. kb_meta 全集 N=3（确保 kbmeta-test 没回归）
node scripts/eval-multidoc.mjs --intent kb_meta --repeat 3

# 5. 全集 N=3（确保整体不抖）
node scripts/eval-multidoc.mjs --repeat 3

# 6. 回滚验证：env=false 应回到老路径（V3D 0/3 fail，证明守卫有效）
KB_META_HANDLER_ENABLED=false node scripts/eval-multidoc.mjs --case D003-V3D --repeat 3
```

## 完成判据

1. `npx tsc --noEmit` exit 0
2. vitest `kbMetaHandler.test.ts` 全过（含新增 3 case）
3. vitest 整套零回归
4. V3D 单 case `--repeat 3` keyword `LFTGATE` 命中率 ≥ 2/3（**核心**）
5. kbmeta-test 单 case 仍 PASS（不能为修 V3D 而误伤其它 kb_meta case）
6. `KB_META_HANDLER_ENABLED=false` 重跑 V3D → 失败回到 baseline 8 行为（证明守卫）

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| Prompt 改后 LLM 在 30 候选里强凑 3 条，挑了不相关的 | candidates 已是 ranked 列表（按 indexed_at DESC + ILIKE 命中），补齐用候选顺序至少不混乱；新测验证 V3D 实际效果 |
| 补齐后 fallback markdownList 显示"找到 3 个相关"但其中 2 个不沾边——用户体验 | 实际 V3D 库里 30 候选大多含工程类（LFTGATE/Bumper/PRD），补齐到 3 条命中率仍可接受；最坏情况比 baseline 8 的"只 1 条"更全 |
| LLM 还是没认 LFTGATE → 没选 → 兜底补齐补不到 LFTGATE | 假设 candidates 顺序里包含 LFTGATE-32（按 indexed_at DESC 在前列），补齐能命中。Verify 单 case 实测会暴露 |
| 既有 kb_meta 用例（kbmeta-test 等）回归 | 旧测全保留 + 新测覆盖；Verify 阶段 `--intent kb_meta` 回归 |

**回滚**：`KB_META_HANDLER_ENABLED=false` 一键回到 D-002.2 之前的 buildKbMetaPrompt + LLM 流路径（不经过本特性的修改）。

## 工作量切片

| Step | 估时 |
|---|---|
| 1 prompt 改写 | 5 min |
| 2 解析逻辑 + 兜底补齐 | 8 min |
| 3 新增 3 个测 case | 7 min |
| 4 tsc 校验 | 1 min |
| 5 vitest 跑（沙箱跑不动；macOS 跑）| - |
| Verify (V3D --repeat 3 + 全集) | 10 min |
| **沙箱内合计** | **~21 分钟** |
