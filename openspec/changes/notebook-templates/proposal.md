# Proposal: Notebook Templates（N-006）

## Problem

新建 Notebook 是"完全空白" → 用户不知道这个产品能干什么、要先上传什么、起手该问什么。
老用户重复创建相似 notebook（"3 份竞品 + 询问差异 + 生成对比矩阵 + briefing"）也是
重复劳动。

## Scope（本 Change）

1. **新增 `services/notebookTemplates.ts`**：
   - `NotebookTemplateId` 6 元 enum
   - `NotebookTemplateSpec` 接口（含 label / icon / desc / recommendedSourceHint /
     recommendedArtifactKinds（复用 N-002 ArtifactKind）/ starterQuestions）
   - `NOTEBOOK_TEMPLATES` 注册表 + `ALL_NOTEBOOK_TEMPLATE_IDS` / `isNotebookTemplateId` /
     `getNotebookTemplate`
2. **数据库**（pgDb.ts ensureSchema）：notebook 表加 `template_id VARCHAR(64)` 字段
   （nullable，老 notebook 兼容）
3. **`POST /api/notebooks`** 加可选 `template_id` 入参，非法 → 400，合法 → 写库
4. **`GET /api/notebooks/:id`** 详情返回追加 `template_id` 字段
5. **新增 `GET /api/notebooks/templates`** 返回所有 6 个模板的 spec（前端创建时用）
6. **前端**：
   - 新建 `NotebookTemplatePicker.tsx` 模板选择器（创建时弹出）
   - 改 `Notebooks/index.tsx` 创建入口 → 先弹模板选择器
   - 改 `Detail.tsx` 顶部加"模板提示卡"（推荐 source / artifact / starter questions）
   - 提示卡可 dismiss（localStorage 记忆 per-notebook）
   - `api/notebooks.ts` 加 `NotebookTemplateId` / `NotebookTemplateSpec` 类型镜像 +
     `listTemplates()` API client
7. **不动**：notebook_source / notebook_chat_message / notebook_artifact 表；
   ChatPanel 渲染主流程；StudioPanel；ARTIFACT_REGISTRY

## Out of Scope（后续 Change）

- 用户自定义模板 / 公共模板市场 → N-008
- 创建时模板自动加 sources → 重，本 change 不做（用户自己加）
- StudioPanel 高亮推荐 artifact 按钮 → 提示卡里点击足够，不冗余
- 模板内容用 LLM 自动评估 / 优化 → D-005 候选

## 决策记录

| ID | 决策 | 替代方案 | 理由 |
|---|---|---|---|
| D-001 | 模板 = 配置（C-B 方案）| 完整 notebook 拷贝 / AI 自动构建 | 轻量、用户保留控制权、可选退出 |
| D-002 | 6 个内置模板 | 更多 / 更少 | 覆盖主流场景；超 6 个维护成本陡 |
| D-003 | 模板内容存代码注册表，DB 只存 template_id | 存 template_meta JSON 整个快照 | 模板升级时老 notebook 看到的是新版（一致体验）；零 migration |
| D-004 | template_id nullable（老 notebook 兼容）| not null + 'blank' 默认 | nullable 最小侵入；前端把 null 视作"无模板" |
| D-005 | 提示卡可 dismiss（localStorage）| 不可关 / 服务端记忆 | 不烦人；服务端记忆要加表，复杂度不值 |
| D-006 | 新增 GET /api/notebooks/templates 接口 | 前端硬编码镜像 | 前端镜像也要做（types），但接口让 server 是 source of truth；下次改模板内容只改一处 |

## 接口契约（freeze 项）

详见 `specs/template-registry-spec.md` + `specs/notebook-create-flow-spec.md`。

下游消费者：
- 未来 N-008 公共模板：复用 NOTEBOOK_TEMPLATES schema 扩展为允许用户提交
- 未来管理后台修改模板内容：直接改 NOTEBOOK_TEMPLATES 注册表 + 重启 service
