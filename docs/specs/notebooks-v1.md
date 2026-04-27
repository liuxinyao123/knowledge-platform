# Notebooks · V1 Spec · 2026-04-22

> NotebookLM 风格的"以工作集为中心"私有 RAG 工作台。
> 已锁定方案：**A1**（与 /spaces 独立共存）+ **B1**（V1 只选已入库 asset）+
> **C**（Chat + Briefing + FAQ 三件套）+ **D2**（行内引用 [^N]）+ **E1**（私有，无共享）。

## 一、用户故事

> 张三今天接到任务："对比 3 份举升门 spec，列出温度补偿方案差异"。
> 他打开 /notebooks → 新建"举升门温度补偿调研"→ 点「+ 添加资料」从全平台 asset 库勾选 LFTGATE-3 / LFTGATE-32 / Bumper BP → 在 Chat 区问"三份文档的温度补偿方案分别是什么？"→ 答案带 [^1][^2] 行内引用，hover 看片段、点击跳到该 asset 的对应位置 → Studio 区点「生成简报」→ 一份结构化对比文档。三天后回来打开同一个 notebook，sources 和聊天记录都在。

## 二、跟现有功能的关系

| 现有 | Notebook V1 |
|---|---|
| /spaces（数据源 → 资产，平台共享） | 不动；notebook 从这里挑 asset |
| /ingest（入库） | 不动；notebook 不直接接管入库流程（V2 再说） |
| /qa（全局问答） | 保留；notebook chat 是它的 scoped 版本 |
| /eval（评测） | 不动；未来扩展为"per-notebook eval" |

## 三、表结构

```sql
-- 工作集本体
CREATE TABLE notebook (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(256) NOT NULL,
  description     TEXT,
  owner_email     VARCHAR(255) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notebook_owner ON notebook(owner_email);

-- 多对多：notebook ↔ metadata_asset
CREATE TABLE notebook_source (
  notebook_id  INT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
  asset_id     INT NOT NULL REFERENCES metadata_asset(id) ON DELETE CASCADE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notebook_id, asset_id)
);
CREATE INDEX idx_notebook_source_asset ON notebook_source(asset_id);

-- chat 历史
CREATE TABLE notebook_chat_message (
  id            SERIAL PRIMARY KEY,
  notebook_id   INT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
  role          VARCHAR(16) NOT NULL,    -- user / assistant
  content       TEXT NOT NULL,
  citations     JSONB,                   -- 仅 assistant 角色，存 [{index, asset_id, asset_name, chunk_content, score}]
  trace         JSONB,                   -- rag pipeline trace
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notebook_msg_notebook ON notebook_chat_message(notebook_id, id);

-- Studio 衍生品（briefing / faq / 未来 mindmap 等）
CREATE TABLE notebook_artifact (
  id              SERIAL PRIMARY KEY,
  notebook_id     INT NOT NULL REFERENCES notebook(id) ON DELETE CASCADE,
  kind            VARCHAR(32) NOT NULL,  -- briefing / faq / study_guide / mindmap / timeline
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending / running / done / failed
  content         TEXT,                  -- markdown 主体
  meta            JSONB,                 -- e.g. {questionCount, sources_snapshot}
  error           TEXT,
  created_by      VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX idx_notebook_artifact_notebook ON notebook_artifact(notebook_id, id DESC);
```

## 四、API 端点（/api/notebooks/*）

| Method | Path | 功能 | 守门 |
|---|---|---|---|
| GET    | /                                    | 列出当前 user 的 notebooks    | requireAuth |
| POST   | /                                    | 新建                          | requireAuth |
| GET    | /:id                                 | 详情（meta + sources + 最近 N 条 chat） | requireAuth + 是 owner |
| PATCH  | /:id                                 | 改名 / 改描述                  | owner |
| DELETE | /:id                                 | 删（级联 sources/chat/artifact） | owner |
| POST   | /:id/sources                         | 加 sources `{asset_ids: number[]}` | owner |
| DELETE | /:id/sources/:assetId                | 移除一个 source               | owner |
| GET    | /:id/messages                        | 拉历史消息（分页）             | owner |
| DELETE | /:id/messages                        | 清空 chat 历史                | owner |
| POST   | /:id/chat (SSE)                      | 发问；SSE 流式返；自动持久化 | owner |
| GET    | /:id/artifacts                       | 列 artifact                   | owner |
| POST   | /:id/artifacts/:kind                 | 触发生成 (briefing/faq)        | owner |
| GET    | /:id/artifacts/:artifactId           | 详情                          | owner |
| DELETE | /:id/artifacts/:artifactId           | 删一个 artifact               | owner |

**`是 owner` 守门规则**：`req.principal.email === notebook.owner_email`，否则 403。
admin 也走同样规则（admin 不能看别人 notebook）。

## 五、Chat 行内引用 [^N] 实现

### Prompt 修改（仅在 notebookChat 内，不动全局 /qa）

```
请基于以下知识库内容回答问题。
**重要**：
1. 你必须 100% 基于以下文档作答，不要引入外部知识
2. 答案中每处引用文档时，必须加 [^N] 标记，N 是文档编号
3. 同一句话引用多个文档用 [^1][^2]
4. 找不到信息就明确说"知识库中没有相关内容"

# 文档：
[1] 文档名 A · p.3
内容...

[2] 文档名 B · p.5
内容...
```

### 前端渲染逻辑

接到 SSE `content` token 流 → 累积到 message.content → 用正则替换 `[^N]` 为可点击的 `<sup>` 标签：
- 颜色：紫色背景 + 白字
- hover：弹卡片显示该 citation 的片段（trace.citations[N-1].chunk_content slice）
- 点击：在右侧 Sources 面板高亮对应 asset；如果 asset 有 path 则在新窗口打开

## 六、Studio Artifact 生成

### Briefing（简报）

**Prompt**：
```
基于以下文档生成一份结构化简报：

# 标题（来自 notebook.name）
## 一、核心论点（每个文档 1-2 句话）
## 二、共识与分歧
## 三、关键数据 / 指标
## 四、行动建议（可选）

要求：
- 严格基于文档内容，不臆测
- 每个论点末尾标 [^N] 引用编号
- 输出 markdown
- 篇幅 800-1500 字

文档：
[1] ... 
[2] ...
```

### FAQ（自动问答）

**Prompt**：
```
基于以下文档生成 8-12 条最值得关注的 FAQ：

格式：
## Q1: ...
**A**: ... [^N]

要求：
- 问题要是真实可能有人问的（不要"该文档讲了什么"这种空洞题）
- 答案 < 100 字，必须带引用
- 覆盖文档的不同方面（不要全集中在一处）
- 输出 markdown

文档：
[1] ...
[2] ...
```

两个 artifact 都是**异步生成**（POST 立返 artifactId，前端 1.5s 轮询直到 status=done）。

## 七、Sources 范围限定的 RAG 实现

`services/ragPipeline.ts` `retrieveInitial()` 当前签名：
```ts
retrieveInitial(question: string, signal: AbortSignal): Promise<AssetChunk[]>
```

V1 改造：
1. 加 `services/knowledgeSearch.ts` 的 `searchKnowledge()` 函数加 `assetIds?: number[]` 参数
2. SQL `WHERE` 条件追加 `AND asset_id = ANY($N::int[])`
3. `retrieveInitial` 透传 `assetIds`
4. 给 `runRagPipeline` 新增 `opts.assetIds` 参数

旧 /qa 不传 → 行为不变。新 notebook chat 传 notebook 的 source asset_id 列表。

## 八、前端

```
/notebooks                    主页：notebook 列表 + 新建
/notebooks/:id                三栏：Sources / Chat / Studio
```

### 三栏布局

```
┌─────────────────────────────────────────────────────────────────┐
│ Header：notebook 名 + 描述 + 返回                                │
├──────────────┬─────────────────────────────────┬────────────────┤
│ Sources      │ Chat                            │ Studio         │
│ ────         │ ────                            │ ────           │
│ + 添加资料   │ 历史 message 列表               │ Briefing       │
│ ☑ 文档 A    │ AI bubble 带 [^1][^2] inline   │  ↳ 生成 / 看   │
│ ☑ 文档 B    │ ↓                               │ FAQ            │
│ ☐ 文档 C    │ 输入框 + 发送                   │  ↳ 生成 / 看   │
│              │                                 │                │
│ (默认全选；   │                                 │                │
│  uncheck     │                                 │                │
│  暂时排除)   │                                 │                │
└──────────────┴─────────────────────────────────┴────────────────┘
  240px         flex 1                            340px
```

### Source picker（"+ 添加资料"弹窗）

- 列出全平台 metadata_asset（按数据源分组）
- 多选 checkbox + 全选/取消
- 顶部搜索按 name 过滤
- 已加进 notebook 的 asset 自动 checked + disabled

### Chat 输入

- 跟 /qa 一致：textarea + Enter 发送 + 发送中可终止
- 流式 SSE 接收
- 完成时持久化（自动）

### Studio

- 两个卡片：Briefing / FAQ
- 每张卡片有"生成"按钮（已生成则显示"重新生成"）
- 点击展开看 markdown（用现成 `MarkdownView`）
- 状态：未生成 / 生成中（loading）/ 完成 / 失败

## 九、不在 V1 的事（明确不做）

- ❌ 行内笔记 / Notes 区
- ❌ Audio Overview / 播客
- ❌ Mind map / Timeline / Study Guide
- ❌ Notebook 共享给其他用户（E2 后置）
- ❌ Notebook 内直接上传新文件（B2 后置 V1.1）
- ❌ Source 选项 partial（基于章节/页选）
- ❌ Per-notebook eval 集成

## 十、工作量预估

| 模块 | 工时 |
|---|---|
| 后端 schema + retrieveInitial 改造 | 0.5d |
| 后端 routes/notebooks.ts | 1d |
| 后端 notebookChat + artifactGenerator | 1d |
| 前端 列表页 + 详情页布局 + Source picker | 1.5d |
| 前端 Chat 含 SSE + 行内 [^N] 渲染 | 1d |
| 前端 Studio Briefing/FAQ 生成 + 渲染 | 0.5d |
| 路由 + 侧栏 + vite proxy | 0.2d |
| tsc 验证 + 烟雾测 | 0.3d |
| **合计** | **~6d** |

今天的 session 一气呵成走 V1 框架；polish（图标 / 动画 / 边界态）后置。
