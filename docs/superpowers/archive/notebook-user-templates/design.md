# Explore · N-008 用户自定义模板

> 工作流：B `superpowers-openspec-execution-workflow` · 阶段 Explore
> 上游：**N-007 必须先合并**（DB schema + service API）
> 下游：N-009 community 提交流程（后续）

---

## 现状（N-007 合并后）

```
DB: notebook_template 表（含 source 字段）
service: loadTemplatesFromDb / getTemplateByKey / seedSystemTemplatesIfMissing
6 个 system 模板 seed 完毕
NotebookTemplateSpec.id 已 widening 到 string
前端 / 后端可见性规则完整
```

---

## 目标（N-008）

让用户能：

1. 创建自己的模板（label / icon / desc / recommendedSourceHint / starterQuestions / recommendedArtifactKinds）
2. 编辑、删除自己的模板
3. 在创建 Notebook 时选择应用自己的模板
4. 自己的模板**仅自己可见**（community 共享是 N-009 范围）

---

## API 设计（CRUD）

```
GET    /api/templates                  list（v1 = N-007 实现）
POST   /api/templates                  create user template
GET    /api/templates/:key             get
PATCH  /api/templates/:key             update（仅自己的；system / community 禁改）
DELETE /api/templates/:key             delete（仅自己的）
```

### POST /api/templates body

```ts
{
  label: string                        // ≤ 10 字
  icon: string                         // emoji 1-2 字符
  description: string                  // ≤ 60 字
  recommendedSourceHint: string        // ≤ 40 字
  recommendedArtifactKinds: ArtifactKind[]  // 0-3 个，必须 ∈ ARTIFACT_REGISTRY
  starterQuestions: string[]           // 1-3 条，每条 ≤ 50 字
}
```

后端：
- 校验所有字段长度 / 数量约束
- `template_key` 后端生成：`user_<userId>_<nanoid(8)>`
- `source = 'user'`
- `owner_user_id = req.user.id`
- 返回 201 + 创建的 NotebookTemplateSpec

### PATCH /api/templates/:key body

可部分更新所有字段（除了 id / source / owner_user_id / template_key 不能改）。仅 owner（或管理员）能改。

### DELETE /api/templates/:key

仅 owner（或管理员）。删后已用该模板的 notebook 的 template_id 字段保留 dangling reference（不级联 update notebook）。

---

## 前端 UI

### 入口

`apps/web/src/knowledge/Notebooks/index.tsx` 模板选择器底部加「+ 创建我的模板」按钮 → 打开模板表单 modal。

### 表单 modal

```
┌─ 创建我的模板 ─────────────────┐
│ 名称 [_____________] (≤10 字)  │
│ Emoji [💡]                     │
│ 简介 [_______________________] │
│ 推荐 sources 引导 [_________]  │
│ 推荐 artifacts                 │
│   [ ] 简报 [ ] 大纲 [ ] FAQ ...│
│ 起手提问 (1-3 条):             │
│   1. [_____________]           │
│   2. [_____________]           │
│   3. [_____________]           │
│ [取消] [创建]                  │
└────────────────────────────────┘
```

### 我的模板管理页

`/notebooks/my-templates` 列表自己的 user 模板，每行有 [编辑] [删除] 按钮。

也可以做"在模板选择器里直接编辑/删除自己的模板"（hover 显示按钮）——更轻量。**v1 选 hover**（不开新页面）。

### 模板选择器加 source 标签

system 模板显示无标签（默认）；user 模板加小角标 `我的`。community 模板（v1 暂无）加 `社区`。

---

## 决策记录

### D-1 · template_key 后端生成

避免用户提交冲突 / 命名安全问题。前端只填字段，后端生成 `user_<userId>_<nanoid>`。

### D-2 · 字段约束跟 N-006 内置模板对齐

label ≤ 10 / desc ≤ 60 / hint ≤ 40 / starterQuestions ≤ 50/each / recommendedArtifactKinds 0-3 个。

### D-3 · 删除模板不级联清空 notebook.template_id

理由：

- 用户已用该模板创建的 notebook 应继续存在
- template_id 字段存的是字符串 key，删模板后变 dangling reference
- 前端 `loadTemplatesFromDb` 时找不到对应 key 就跳过显示模板提示卡（TemplateHintCard 已有处理 N-006 删 unused 的逻辑）
- 不级联是 D-3 in N-007 的延续

### D-4 · v1 不做 community 共享

`source = 'community'` 字段已在 schema，但 N-008 不提供 promote 路径。N-009 后续做"我把我的模板分享给社区"流程。

### D-5 · 表单 modal 而非新页

减少导航成本；创建后立即回到模板选择器并自动选中新创建的模板。

---

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| 用户大量创建低质模板污染 UI | v1 仅自己可见，污染范围限自己；N-009 community 加审核 |
| 删除模板后 dangling reference | 前端 graceful fallback（找不到模板就不显示提示卡）|
| recommendedArtifactKinds 包含未定义 kind | 后端 validate against `ARTIFACT_REGISTRY` |
| 用户编辑 system 模板 | 服务层 owner check 拒绝（system.owner_user_id IS NULL） |

**回滚**：禁用 N-008 新 API endpoints（feature flag `USER_TEMPLATES_ENABLED`），UI 隐藏"+ 创建我的模板" 按钮。

---

## 不在范围

- community 共享 / promote 流程
- 模板版本历史
- 模板评分 / 收藏
- 跨用户复制模板（"克隆其他人的"）

---

## Acceptance

1. POST/PATCH/DELETE 三个 API 完整覆盖且 owner check 严格
2. 字段长度约束服务端 + 前端表单都校验
3. 用户创建模板后立即在模板选择器中可见
4. 用户删除模板后该模板从选择器消失，已应用该模板的 notebook 仍正常打开
5. 试图编辑 system 模板 → 403
6. 试图编辑别人的 user 模板 → 403（普通用户）/ 200（管理员）
7. vitest 单测全过 + 整套零回归

---

## 工作量估算

| 阶段 | 时间 |
|---|---|
| Lock OpenSpec | 15 min |
| 后端 CRUD + 校验 | 30 min |
| 前端表单 modal | 30 min |
| 前端模板选择器集成 | 15 min |
| 单测 + Verify | 20 min |
| **合计** | **~1.8 小时** |
