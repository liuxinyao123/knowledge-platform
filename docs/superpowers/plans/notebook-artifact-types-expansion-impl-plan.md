# Impl Plan · N-002 Notebook Artifact 类型扩展

> 工作流：B `superpowers-openspec-execution-workflow`
> 阶段：Execute（B-3）
> OpenSpec：`openspec/changes/notebook-artifact-types-expansion/`
> Explore：`docs/superpowers/specs/notebook-artifact-types-expansion/design.md`

## 已完成清单（task 编号对照 tasks.md）

| Task | 文件 | 改动 |
|---|---|---|
| BE-1..BE-5 | `apps/qa-service/src/services/artifactGenerator.ts` | 重构：`ArtifactKind` 8 元 union / `ArtifactSpec` interface（含 N-005 候选 `intent?` 字段）/ `ARTIFACT_REGISTRY` 8 项 / `ALL_ARTIFACT_KINDS` / `isArtifactKind` / `getArtifactSpec` / 删除原 `PROMPT_BRIEFING`/`PROMPT_FAQ` 常量 |
| BE-6..BE-11 | 同上 | `executeArtifact` 用 `getArtifactSpec(kind)` 替代 if-else / 用 `spec.promptTemplate`/`spec.maxTokens`/`spec.temperature?` 调 chatComplete / `collectAssetContent` 加 `strategy` 参数（'extended' → 16 samples / 6000 字符上限）/ 用户消息固定 `'请生成${spec.label}。'` / 非法 kind 抛错并 catch 标 failed |
| BE-12 | `apps/qa-service/src/routes/notebooks.ts:324` | 校验改用 `isArtifactKind`，错误信息 `kind must be one of: <8 个 kind>` |
| BE-13..BE-19 | `services/artifactGenerator.ts` | 6 个新 prompt 模板：mindmap / outline / timeline / comparison_matrix / glossary / slides；全部含 `[^N]` 字面占位；不绑定具体文档形态（道德经/老子/缓冲块/COF/B&R/Swing 等禁词检查） |
| BE-20 | `apps/qa-service/src/__tests__/artifactRegistry.test.ts`（新建）| 7 块测试 × 30+ assertion：8 元 union / 完整性 / 守卫 / 引用 / promptTemplate `[^N]` / 禁词 / N-005 候选未消费 / slides extended |
| BE-21 | `npx tsc --noEmit` | exit 0 |
| BE-22 | tsx smoke `/tmp/smoke_n002.ts` | 8 个 kind × 多维度断言全过（修了 timeline 缺 [^N] 后 53/53）|
| FE-1 | `apps/web/src/api/notebooks.ts` | `ArtifactKind` 类型扩到 8 元 + 新增 `ALL_ARTIFACT_KINDS` 镜像常量 |
| FE-3 | `apps/web/src/knowledge/Notebooks/StudioPanel.tsx` | `KINDS` 数组从 2 项扩到 8 项（id/label/icon/desc 跟后端一致）|
| DOC-1 | `docs/superpowers/specs/notebook-artifact-types-expansion/design.md` | B-1 |
| DOC-2 | `openspec/changes/notebook-artifact-types-expansion/{proposal,specs/artifact-registry-spec,tasks}.md` | B-2 |
| DOC-3 | 本文件 | B-3 |

## 待办（B-4 验证 · 用户在 macOS 跑）

| Task | 期望产物 | 谁做 |
|---|---|---|
| V-1 | `pnpm -C apps/qa-service test` 通过 artifactRegistry 30+ assertion + 现有套件零回归 | user |
| V-2 | 重启 qa-service + Web UI 在某 notebook（≥ 1 source）StudioPanel 触发生成 8 类中至少 4 类（briefing / mindmap / glossary / slides）| user |
| V-3 | curl 直发非法 kind → 期望 400 + 错误信息列出 8 合法 kind | user |
| V-4 | 跨文档类型 manual：英文 SOP notebook 触发 outline / 中文产品 notebook 触发 mindmap / 多 source notebook 触发 comparison_matrix | user |
| V-5 | 8 类 artifact content 都含 `[^N]` 引用 + 无 hardcoded 词 | user |
| V-6 | slides 用 extended context（容量大）vs glossary 默认（容量小）—— 验证 contextStrategy 生效（slides 答案 ≥ 1500 字、glossary 答案 ≤ 800 字）| user |
| AR-* | specs → archive；看板 Done；通知下游：N-003 / N-005 / N-006 可消费 ARTIFACT_REGISTRY | user |

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| 6 个新 prompt 在某些文档类型上表现差（如表格类） | 抽象规则 + 输出兜底（如 timeline 无时间数据时声明）；V-2/V-4 实测验证 |
| 前后端类型不同步 | `ALL_ARTIFACT_KINDS` 前后端各一份手写镜像，加注释互链；V-1 在 web 也加同步检查 |
| 老 notebook_artifact 数据兼容 | DB 字段无 enum constraint；老 briefing/faq 行不动，新 6 类用户开始用后产生新行 |
| 整套 N-002 revert | 注册表 + 路由校验 + 前端 KINDS 同步 revert；老 briefing/faq 行为完全不变 |

## 与 N-003 / N-005 / N-006 的对接

- **N-003** sources 变更监听：消费 `ALL_ARTIFACT_KINDS` 决定哪些 kind 标 stale
- **N-005** artifact 接入意图分流：给每个 spec 填 `intent`；executeArtifact 改 `if (spec.intent)` 走 `buildSystemPromptByIntent` 而非 `spec.promptTemplate`
- **N-006** Notebook templates：模板预设 artifact 套件时引用 `ALL_ARTIFACT_KINDS`
