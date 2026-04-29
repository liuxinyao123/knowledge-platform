# Tasks: N-002 Notebook Artifact 类型扩展

> 工作流：B `superpowers-openspec-execution-workflow`
> 状态：B-2 OpenSpec Lock 完成；进 B-3 Execute

## 后端（apps/qa-service）

### 注册表 + 类型扩展
- [ ] BE-1：`services/artifactGenerator.ts` —— `ArtifactKind` 从 2 元 union 扩到 8 元
- [ ] BE-2：新增 `ArtifactSpec` interface（id / label / icon / desc / promptTemplate /
      maxTokens / temperature? / intent? / contextStrategy?）
- [ ] BE-3：新增 `ARTIFACT_REGISTRY: Record<ArtifactKind, ArtifactSpec>` 含 8 项
      （现有 briefing + faq 移植 + 新 6 项）
- [ ] BE-4：新增 `ALL_ARTIFACT_KINDS` / `isArtifactKind` / `getArtifactSpec`
- [ ] BE-5：删除原 `PROMPT_BRIEFING` / `PROMPT_FAQ` 常量（迁入 ARTIFACT_REGISTRY）

### executeArtifact 改造
- [ ] BE-6：`executeArtifact` 用 `getArtifactSpec(kind)` 替代 if-else 选 prompt
- [ ] BE-7：用 `spec.promptTemplate` 拼 system prompt（保留 `{标题}` 占位符替换）
- [ ] BE-8：用 `spec.maxTokens` / `spec.temperature` 调 chatComplete
- [ ] BE-9：用户消息固定为 `'请生成${spec.label}。'`
- [ ] BE-10：`collectAssetContent` 加 `contextStrategy` 参数；'extended' 时
      拿 16 个 samples + 6000 字符上限（slides 用）
- [ ] BE-11：kind 非法时抛 `Error('unknown artifact kind: ${kind}')` + catch 标 failed

### 路由层
- [ ] BE-12：`routes/notebooks.ts:324` 校验改用 `isArtifactKind`，错误信息列出
      8 个合法 kind

### 6 个新 prompt 模板（按 design.md 表格）
- [ ] BE-13：mindmap prompt（markdown 嵌套列表 + 中心主题加粗 + 3-4 层）
- [ ] BE-14：outline prompt（一二三级 markdown headings + 每节 1-2 行说明）
- [ ] BE-15：timeline prompt（markdown 表格或时序列表 + 日期/事件/[^N]）
- [ ] BE-16：comparison_matrix prompt（markdown table + 对象作行 + 维度作列）
- [ ] BE-17：glossary prompt（"**术语**：定义 [^N]" 列表 + 按字母/拼音序）
- [ ] BE-18：slides prompt（"## Slide N: 标题\n- 要点\nNotes: ..." 8-15 张）
- [ ] BE-19：所有 prompt 含 `[^N]` 引用样式 + 不含 hardcoded 文档形态词
      （道德经/老子/缓冲块/COF/B&R/Swing/油漆变差/铰链公差禁词）

### 测试
- [ ] BE-20：`__tests__/artifactRegistry.test.ts`（新建）
      - ArtifactKind 8 元
      - ARTIFACT_REGISTRY 完整性（每个 kind 的 spec 字段都非空）
      - isArtifactKind 守卫
      - getArtifactSpec 返回引用
      - 8 个 promptTemplate 含 `[^N]` 字面 + 禁词检查
      - intent 字段全为 undefined（N-002 不消费）
      - slides 用 extended contextStrategy + maxTokens >= 3000
- [ ] BE-21：tsc clean
- [ ] BE-22：tsx smoke 验证 ARTIFACT_REGISTRY 8 项 + 禁词

## 前端（apps/web）

### 类型同步
- [ ] FE-1：`api/notebooks.ts` —— `ArtifactKind` 类型定义扩到 8 元
- [ ] FE-2：（可选）`api/notebooks.ts` 增加 `ALL_ARTIFACT_KINDS` 常量镜像

### StudioPanel 扩展
- [ ] FE-3：`knowledge/Notebooks/StudioPanel.tsx` —— `KINDS` 数组从 2 项扩到 8 项
      （id / label / icon / desc 跟后端 ARTIFACT_REGISTRY 一致）
- [ ] FE-4：（可选）KINDS 按类型分组（"总结类" / "结构类" / "对比类"）便于 UI 展示

### 测试
- [ ] FE-5：（可选）`StudioPanel.test.tsx` 验证 8 个 KINDS 全渲染

## 文档
- [x] DOC-1：`docs/superpowers/specs/notebook-artifact-types-expansion/design.md` ✓
- [x] DOC-2：`openspec/changes/notebook-artifact-types-expansion/{proposal,specs/*-spec,tasks}.md` ✓
- [ ] DOC-3：`docs/superpowers/plans/notebook-artifact-types-expansion-impl-plan.md`
      （B-3 完成后倒推记录）

## 验证（B-4 前置）
- [ ] V-1：`pnpm -C apps/qa-service test` 通过 artifactRegistry 新套件 + 现有
      套件零回归
- [ ] V-2：在某 notebook 内（≥ 1 source）通过 StudioPanel UI 触发生成 8 类
      artifact 中至少 4 类（briefing / mindmap / glossary / slides 覆盖不同
      maxTokens / contextStrategy）
- [ ] V-3：触发非法 kind（curl 直发）→ 期望 400 + 错误信息列出 8 合法 kind
- [ ] V-4：跨文档类型 manual：在英文 SOP notebook 触发 outline / 在中文产品
      notebook 触发 mindmap / 在多 source notebook 触发 comparison_matrix
- [ ] V-5：8 类 artifact content 都含 `[^N]` 引用 + 无 hardcoded 词
- [ ] V-6：slides 用 extended context（容量大）vs glossary 默认（容量小）—
      验证 contextStrategy 生效

## Archive（B-4 验证通过后）
- [ ] AR-1：specs/notebook-artifact-types-expansion → archive/
- [ ] AR-2：看板 Done
- [ ] AR-3：合并 PR；ArtifactKind enum freeze
- [ ] AR-4：通知下游：N-003 / N-005 / N-006 可消费 ARTIFACT_REGISTRY 接口
