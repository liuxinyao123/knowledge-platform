# ADR 2026-04-25-41 — Skill Bridge MVP（OQ-SKILL-BRIDGE Phase 1）

> 工作流 C · `superpowers-feature-workflow`（无 OpenSpec；变更面小且增量纯加法）。
> 上游：ADR-39 D-007（WeKnora #5 从未登记升级为登记 OQ-SKILL-BRIDGE）
> 关联 Open Question：`OQ-SKILL-BRIDGE`（保持 in-flight；本 ADR 仅交付 Phase 1 MVP）

## Context

ADR-39 D-007 把"qa-service Agent 消费 mcp-service 声明式 Skill"从未登记升级为登记的
`OQ-SKILL-BRIDGE`。两档解决路径在 OQ 条目里写明：

- **MVP 弱解读**（~0.5 人天）：qa-service 直接 import / 本地实现，绕过 MCP 协议
- **完整 强解读**（~2-3 人天）：起 MCP client + 自动重连，把 Skill 注册成 LLM 工具

用户 2026-04-25 选择立刻开干，按 OQ 的"决策时机"建议先 MVP 跑通。本 ADR 记录 MVP 阶段
的具体决策与 4/8 范围裁剪。

## Decision

### D-001 不引入跨 workspace 包导入；qa-service 内**重写**而非复用 mcp-service skill 实现

mcp-service 的 skill 实现有两类：
- **hook 类**（2 个 legacy）：`*.hook.ts` 内 `run(input, ctx)` 调 mcp-service 自己的
  `services/bookstack.ts`
- **http 类**（6 个）：YAML 模板 POST 到 qa-service 自己的 HTTP 路由

qa-service 复用 mcp-service 实现的话需要：
1. 跨 workspace TS 路径（`../mcp-service/src/skillLoader.ts`），fragility 高；
2. http 类会回环到 qa-service 自己的 `/api/qa/retrieve` 等端点，HTTP self-loop 浪费；
3. mcp-service 有 `js-yaml` 依赖，qa-service 也得加。

**取舍**：本桥**不**复用 mcp-service 实现，而是 qa-service 内**重写**一份本地 handler，
直接调 qa-service 已有的 `bookstack.searchPages` / `searchHybrid` /
`getAssetNeighborhood` / `getPageContent`。零新依赖、零 HTTP roundtrip、零跨包导入。

代价：双份实现可能 drift。**缓解**：drift 单测（见 D-003）。

### D-002 范围裁剪 4/8（只读 + 端点已就位）

| Skill | 状态 | 处置 |
|---|---|---|
| `search_knowledge` | ✓ qa-service `bookstack.searchPages` 已有 | **MVP 落地** |
| `get_page_content` | ✓ qa-service `bookstack.getPageContent` 已有 | **MVP 落地** |
| `ontology.query_chunks` | ✓ qa-service `searchHybrid` 已有 | **MVP 落地** |
| `ontology.traverse_asset` | ✓ qa-service `getAssetNeighborhood` 已有 | **MVP 落地** |
| `ontology.match_tag` | ✗ `/api/ontology/match` 端点未实现 | 延后到端点落地 |
| `ontology.path_between` | ✗ `/api/ontology/path` 端点未实现 | 同上 |
| `action.execute` | 写操作；ADR-30 + actionEngine 仍在演进 | 延后；不在本桥 MVP scope |
| `action.status` | 同上（依附 actionEngine） | 同上 |

不接入 4 个并不阻塞 OQ-SKILL-BRIDGE 的核心目标（"agent 可消费 skill"）—— 主流的检索/邻域
查询路径已通；写类 + 高级 ontology 操作留给 Phase 2。

### D-003 drift 防护：单测读 yaml name 与 SKILLS catalog 比对

- `__MCP_YAML_PATHS_FOR_DRIFT_CHECK` 列出 4 个 mcp-service yaml 路径作硬编码引用
- 单测读文件 + 正则提取 `^name:\s*(\S+)` 比对 `SKILLS.map(s => s.name)`
- yaml 改名 / 删除 / SKILLS 缺失 → 测试 fail，CI 阻断

不引入 `js-yaml` 依赖（正则提取 name 字段足够覆盖最常见 drift）；input/output schema 的
深度对齐**不做**——双份 schema 在所难免，schema drift 由 manual review 处理。

### D-004 Phase 1 不动任何 agent

OQ-SKILL-BRIDGE 原文：
> "决策时机：等 OQ-AGENT-1 触发时再做选择"

按此原则：
- `KnowledgeQaAgent.run` 不改（仍单调用 `runRagPipeline`）
- `dataAdminAgent.runDataAdminPipeline` 不改（已有的本地 TOOLS 不动）
- `StructuredQueryAgent` / `MetadataOpsAgent` 是占位，更不动

skillBridge 作为**ready-to-consume API** 摆在那。当 OQ-AGENT-1 ReACT change 启动时，
ReACT 工具集合直接 `listSkills() → register as tools` 即可。

### D-005 默认启用、env flag 关停

`SKILL_BRIDGE_ENABLED=true` 是默认。理由：

- skillBridge 单纯增加导出，不修改任何业务路径，没有副作用；
- 没有 agent 消费的情况下 listSkills() 等 API 调用次数为零，运行时成本可忽略；
- env flag 仅作"应急关停"——若未来某个消费路径出现 bug 可以一键禁用整个桥而不回滚代码。

## Consequences

### 正向

- 4 个核心 Skill 在 qa-service 内可调，无需起 mcp-service stdio / HTTP；
- 后续 ReACT change（OQ-AGENT-1）落地时直接 `import { listSkills, callSkill }` 即可；
- mcp-service 端零改动，外部 client（Cursor / Claude Desktop）行为不变；
- drift 单测让 4 个 yaml 与 skillBridge 不会偷偷不一致。

### 负向

- 双份实现：mcp-service 的 hook 与 qa-service 的 handler 各跑各的，schema drift 仅
  靠人工 review；
- input/output schema 在 skillBridge.ts 是手抄一份的简化 JSON Schema，与 yaml 完整
  schema 可能在精细字段（如 `default` / `description` 文本）有微差；
- 4 个延后的 skill（match_tag / path_between / action.\*）需要后续单独补；
- 当前桥**没有** principal 透传 / auth.forward 等 mcp-service 端有的能力 —— Phase 2
  接 ReACT 时若需要按用户身份限权再补。

### 与 D-007 的对照

| D-007 提议 | 本 ADR 实施 | 偏差 |
|---|---|---|
| MVP "直接 import handler" | 重写本地 handler（不 import mcp-service）| 比 D-007 提议更保守；理由见 D-001 |
| 4/8 vs 8/8 | 4/8（半数 skill 落地）| D-007 未明确范围；本 ADR 的 D-002 裁剪 |
| 不动 agent | 严格遵守 | 一致 |

## 实施与验证

### 代码落盘

| 文件 | 类型 | 行数 |
|---|---|---|
| `apps/qa-service/src/services/skillBridge.ts` | 新建 | 282 |
| `apps/qa-service/src/__tests__/skillBridge.test.ts` | 新建 | 163 |
| **合计** | | **445** |

### 验证（用户 Mac · 2026-04-25 10:21）

- `pnpm -r exec tsc --noEmit` · qa-service / mcp-service / web 三包**全绿**
- `pnpm --filter qa-service test` · **Test Files 58 passed (58) / Tests 385 passed (385)** · 11.04s
  - 含本 ADR 新增 9 个 case（catalog / list / 4 个 skill 路由 / 输入校验 / 未注册 / disabled / drift 护栏）
- mcp-service 端零改动，未触发回归

### 不验证（不在 MVP scope）

- 端到端：agent 通过 LLM tool-call 调 callSkill —— 无 agent 消费方
- 性能：单 skill 调用延迟 / 吞吐量 —— 没有生产负载
- mcp-service 端外部 client 行为 —— 改动面零

## Follow-up

1. **OQ-SKILL-BRIDGE 不关闭**：完整版（MCP client + 自动重连）仍待 OQ-AGENT-1 触发；
   open-questions.md 在此 OQ 下追加"MVP 2026-04-25 已交付"作 milestone。
2. **`ontology.match_tag` / `ontology.path_between` 接入**：阻塞在 qa-service 端
   `/api/ontology/match` 与 `/api/ontology/path` 路由未实现。这两个端点的 spec 不在 ADR-33
   `ontology-oag-retrieval` Phase 1 范围内 —— 需要新 change 或 OQ。**留意**：
   建议在 ontology 后续 change（若有）里一并实现；本 ADR 不创建新 OQ。
3. **`action.execute` / `action.status` 接入**：等 ADR-30 与 actionEngine 演进稳定。
4. **schema drift 加 input/output 深度对齐**（可选）：当前 drift 护栏只管 name；若双份
   schema 失同步导致下游问题，再加 schema 比对。
5. **ReACT 启动时把 skillBridge 接入 KnowledgeQaAgent / 新 ReactAgent**：见 OQ-AGENT-1。

## Links

- 上游决策：ADR-39 D-007（`decisions/2026-04-24-39-weknora-borrowing-map.md`）
- 上游 OQ：`open-questions.md` `OQ-SKILL-BRIDGE`
- 同源 mcp-service 设计：ADR-34 `ontology-declarative-skills`
- 实现：`apps/qa-service/src/services/skillBridge.ts` · `apps/qa-service/src/__tests__/skillBridge.test.ts`
- 4 个 yaml 真相源：`apps/mcp-service/skills/{search_knowledge,get_page_content}.skill.yaml` 与
  `apps/mcp-service/skills/ontology/{query_chunks,traverse_asset}.skill.yaml`
