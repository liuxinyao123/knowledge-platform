# ADR 2026-04-25-43 — web 测试集债务清理（OQ-WEB-TEST-DEBT 关闭）

> 工作流 C · `superpowers-feature-workflow`（无 OpenSpec；纯测试基础设施 + mock 修复）
> 关联 Open Question：`OQ-WEB-TEST-DEBT`（本 ADR 关闭并迁到"已关闭"）
>
> **编号说明**：今日（2026-04-25）已存在两份 ADR-41（`graph-insights.md` + `skill-bridge-mvp.md`）的撞号 + ADR-42 `knowledge-graph-view.md`，本 ADR 顺延为 43。撞号本身需要后续整理（独立工作）。

## Context

OQ-WEB-TEST-DEBT 在 2026-04-25 上午通过给 `apps/web/package.json` 加 `"test": "vitest run"` 脚本暴露：vitest + jsdom + setup 早就配好了，只是 npm script 缺位，导致 `apps/web/` 测试集**长期未被任何 CI 跑过**。一加就跑出 18 失败 + 4 errors / 16 文件中 5 文件挂。

按 OQ 原文 4 步建议解决路径：
1. snapshot 失败现状（已隐含在 OQ 条目里）
2. 批量修 mock 缺口
3. skip 修不完的题
4. 通用 axios mock 提到 `setup.ts`

本 ADR 记录路径 4（先做）+ 路径 2（后做）的具体落地，以及为什么**没用**路径 3。

## Decision

### D-001 路径 4 优先：全局 axios stub 进 `setup.ts`

`apps/web/src/test/setup.ts` 加 `vi.mock('axios')` 全局拦截：所有 `axios.create()` 实例的 get/post/put/patch/delete 默认 resolve 为 friendly empty body：
```ts
{ items:[], data:[], rows:[], list:[], results:[], chunks:[], nodes:[], edges:[],
  total:0, count:0, ok:true }
```

**理由**：apps/web/src/api/*.ts 共 16 个文件统一用 `axios.create({baseURL:'/api/...'})` 模式，一次性 mock 该路径覆盖**所有**"组件 mount 时打真实 HTTP" 类失败。

**直接收益**：4 个 unhandled promise rejection 全部消失，输出从噪声变干净。其余 18 个测试失败浮出真实 assertion 问题，不再被 ERR_NETWORK 压住。

**未涉及**：
- 个别测试需特定响应 → 文件级 `vi.mock('@/api/foo')` 局部覆盖（已是既有惯例）
- 特殊场景需要真实 axios → 文件顶部 `vi.unmock('axios')` 显式恢复

### D-002 路径 2：按文件逐个修剩余 18 个 mock 缺口 / 选择器问题

按 verbose 输出归类分 5 文件：

| 文件 | 失败数 | 根因 | 修法 |
|---|---|---|---|
| `Governance/index.test.tsx` | 11 | ① 测试 mock `govApi.getShelfVisibility / updateShelfVisibility`（BookStack shelf 时代），但 ADR-26 后 SpacesTab 改读 `listSpaces / updateSpace`（`@/api/spaces`）；② TagsPanel mount 拉 `govApi.listTags` 但 mock 缺；③ 知识治理 tab 默认渲染但 wrapper 没 `data-testid="tab-content-knowledge"`；④ "产品" 渲染为 `📁 产品` 多文本节点 | mock 工厂补 6 个 govApi 方法 + 加 `vi.mock('@/api/spaces')` + `KnowledgeOps` 组件加 testid + 测试改 regex `/产品/` 匹配 |
| `Ingest/index.test.tsx` | 4 | `IngestConfigPanel` mount 调 `listSpaces / listSpaceSources / listPgSources`，测试 mock 全缺 | mock 工厂加 `@/api/spaces` + 扩 `@/api/assetDirectory` |
| `Agent/index.test.tsx` | 1 | `<span>KnowledgeQaAgent</span> · 48ms` 多文本节点，`getByText('KnowledgeQaAgent')` 精确匹配挂 | 改 `getAllByText(/KnowledgeQaAgent/)` 部分匹配 |
| `Notebooks/ShareModal.test.tsx` | 1 | `findByText(/Book\|共享\|Share/i)` 同时匹配标题 + 描述（"共享" 出现 ≥2 次） | 改 `findAllByText` |
| `QA/index.test.tsx` | 2 | ① 会话列表 + 消息气泡都含 `什么是知识图谱？` 文本；② 组件改用 `0.82` 显示，测试还断言 `82%` | ① `getAllByText` 容忍多匹配；② 改 `getByText(/0\.82/)` |

涉及 6 处组件 / 测试改动，**1 处真组件改动**（`KnowledgeOps/index.tsx` 加 `data-testid`），其余都是 test 文件改。

### D-003 路径 3 不用（`it.skip` 标注）

OQ 原文路径 3 建议"修不完的题先 skip"。**实际所有 18 个都修好了**，无需 skip。这是好事，但意味着 OQ 关闭后未来若类似债再起，仍可用 skip 兜底（保留作 follow-up 工具）。

### D-004 测试本身有 bug 还是组件改了 spec → 都按"测试跟组件"原则改测试

5 个文件里的失败几乎全是**组件演进后测试没跟**，不是组件 bug。例外：`KnowledgeOps` 组件外层缺 `data-testid="tab-content-knowledge"` 是真组件遗漏（同其它三个 tab 都有），加上是合理的标准化。

按"测试服务于代码当前形态"的原则，所有改动**都改测试不改组件**（除 `KnowledgeOps` 那一处）。

## Consequences

### 正向

- web 测试集从"0 真跑过 + 18 隐藏失败"变成"114/114 全绿 + CI 实时监督"
- 全局 axios stub 给后续新写测试一个干净起点：默认空响应 + 友好字段 = 大多数组件能渲染到第一个有意义的 assertion
- 5 个测试文件的修复模式（多文本节点 → regex / `getAllByText`，过时 mock → 换新 API 包）写入注释，可作未来类似 debt 修复的速查参考
- `OQ-WEB-TEST-DEBT` 从未决迁到已关闭，账面更清晰

### 负向

- `axios` 全局 mock 是"激进"做法 —— 未来若有测试想要真实 axios 行为，要在该测试文件顶部 `vi.unmock('axios')` 显式恢复。这是隐性约定，不在文件外可见
- 5 个文件改动带 `OQ-WEB-TEST-DEBT (2026-04-25)` 注释，未来归档老旧之后这些注释会成为需要清理的"考古噪声"——但这是有意的取舍（可追溯性 > 干净度）
- 没有为 vitest 的 setup 添加 type 提示 / autocomplete，开发者写测试时仍可能 mock 错路径

### 数据流

```
路径 4：18 fail / 4 errors  →  18 fail / 0 errors（unhandled rejection 消失）
路径 2 第一轮：              →  4 fail（Governance / Agent / ShareModal / QA 各部分修好；Governance/Ingest 全清）
路径 2 第二轮：               →  1 fail（Governance "产品" 多文本节点）
路径 2 第三轮：               →  0 fail
```

每轮跑 `pnpm --filter web test` 反馈到下一轮 mock 修复，3 个迭代收敛。

## 实施与验证

### 代码落盘

| 文件 | 类型 | 净增 |
|---|---|---|
| `apps/web/package.json` | 修改 | +1 行 (`"test": "vitest run"`) |
| `apps/web/src/test/setup.ts` | 修改 | 1 → 70 行（全局 axios stub）|
| `apps/web/src/knowledge/Governance/KnowledgeOps/index.tsx` | 修改 | +1 字符（`data-testid` 属性）|
| `apps/web/src/knowledge/Governance/index.test.tsx` | 修改 | +20 行 mock + 选择器 |
| `apps/web/src/knowledge/Ingest/index.test.tsx` | 修改 | +10 行 mock |
| `apps/web/src/knowledge/Agent/index.test.tsx` | 修改 | +1 行（regex 选择器）|
| `apps/web/src/knowledge/Notebooks/ShareModal.test.tsx` | 修改 | +2 行（findAllByText）|
| `apps/web/src/knowledge/QA/index.test.tsx` | 修改 | +3 行（多匹配 + 数字格式）|

### 验证（用户 Mac · 2026-04-25 11:30）

- `pnpm --filter web test` · **Test Files 16 passed (16) / Tests 114 passed (114)** · 9.25s
- TSC 三包零错（qa-service / mcp-service / web）

## Follow-up

1. **统一 axios mock 提供器**（可选）：当前各文件还有 `vi.mock('@/api/foo')` 重复模板，未来可抽 `__test__/mocks/api.ts` 统一导出。等下次 web 大规模重构时再做。
2. **CI 可见 web test 状态**：建议把 `pnpm --filter web test` 加进现有 CI/lint hooks（如果有）。本 ADR 不动 CI 配置。
3. **ADR 编号清理**：今天 2026-04-25 有 ADR-41 撞号（`graph-insights` + `skill-bridge-mvp`）。建议下次有空时给其中一个改名（仿 ADR-39 D-007 的处置），不影响功能。

## Links

- 上游 OQ：`open-questions.md` `OQ-WEB-TEST-DEBT`（本 ADR 关闭后迁"已关闭"）
- 关联 ADR：
  - ADR-39 `weknora-borrowing-map`（D-007 的 "工具链债" 同源精神）
  - ADR-26 `space-permissions`（导致 SpacesTab API 切换的根因）
  - ADR-41 `skill-bridge-mvp`（撞号兄弟）
- 同期产出：`PROGRESS-SNAPSHOT-2026-04-25-cleanup-day.md`（汇总今天所有 work）
