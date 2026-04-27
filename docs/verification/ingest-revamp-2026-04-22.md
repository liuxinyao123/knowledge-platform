# /ingest 重做 · 2026-04-22 交付清单

## 范围

按 prototype 重做了 `/ingest` 页：4 Tab（文件上传 / 网页抓取 / 对话沉淀 / 批量任务）+ 共享配置面板 + 实时任务队列 + 独立的「数据预处理模块」详情页。

## 后端新增

| 文件 | 说明 |
|---|---|
| `apps/qa-service/src/services/jobRegistry.ts` | in-memory 任务注册表；6 步 phase 模型；LRU 200 |
| `apps/qa-service/src/routes/ingestJobs.ts` | `GET /api/ingest/jobs` list / `GET /:id` detail / `POST /:id/pause` / `POST /:id/retry` |
| `apps/qa-service/src/routes/ingest.ts`（扩） | 新增 `POST /upload-full`、`POST /fetch-url`、`POST /conversation` 三个高层入口；都返 202 + `{jobId}` |
| `apps/qa-service/src/index.ts`（改） | 挂载 `app.use('/api/ingest/jobs', ingestJobsRouter)` |

> 注意：
> - 新版 upload-full 用的是 `services/ingestPipeline/index.ts` 的 unified 路径，**不再走 BookStack 创页**。直接进 `metadata_asset` + `metadata_field`。
> - 旧的 `/api/ingest/extract-text` + `/api/ingest/register-indexed-page` 没动，老 Wizard 还可以用（但前端已经不调了）。
> - `/api/ingest/jobs/*` 只挂 `requireAuth`，无 `enforceAcl`；权限验证矩阵里属于 §2.5「仅 requireAuth」一类。

## 前端新增 / 改

| 文件 | 说明 |
|---|---|
| `apps/web/src/api/ingest.ts`（扩） | 加 `uploadFull / fetchUrl / ingestConversation / listJobs / getJob / pauseJob / retryJob` |
| `apps/web/src/knowledge/Ingest/IngestConfigPanel.tsx`（新） | 右侧配置：目标空间 / 标签 / 分段策略 / 向量化 toggle |
| `apps/web/src/knowledge/Ingest/JobQueue.tsx`（新） | 底部任务队列；2s 轮询；进度条 + 操作（日志/暂停/重试） |
| `apps/web/src/knowledge/Ingest/EmptyState.tsx`（新） | 空态引导 |
| `apps/web/src/knowledge/Ingest/UploadTab.tsx`（新） | drop zone + 文件选择 |
| `apps/web/src/knowledge/Ingest/FetchUrlTab.tsx`（新） | URL 输入 + 抓取 |
| `apps/web/src/knowledge/Ingest/ConversationTab.tsx`（新） | JSON / 「user:/assistant:」纯文本两种解析方式 |
| `apps/web/src/knowledge/Ingest/BatchTab.tsx`（新） | 包旧 ZipImporter + 简短说明 |
| `apps/web/src/knowledge/Ingest/index.tsx`（重写） | 4 Tab + 配置 + 队列 |
| `apps/web/src/knowledge/Ingest/index.test.tsx`（重写） | 烟雾测试覆盖 4 Tab + 配置面板 |
| `apps/web/src/knowledge/IngestJob/index.tsx`（新） | 路由 `/ingest/jobs/:id`；6 步 stepper + 进度 panel + 表格预览 + 日志 |
| `apps/web/src/App.tsx`（改） | 加 `<Route path="ingest/jobs/:id" element={<IngestJobDetail />} />` |

## 验证清单

### 前置

```bash
cd /Users/xinyao/Git/knowledge-platform
pnpm dev:down && pnpm dev:up      # qa-service 加了路由必须重启
pnpm --filter web build           # 或 dev 起 vite
```

### 后端 smoke（curl）

```bash
ADMIN_TOKEN=$(curl -s http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@dsclaw.local","password":"admin123"}' | jq -r .token)

# 1) 列任务（应空）
curl -s http://localhost:3001/api/ingest/jobs \
  -H "authorization: Bearer $ADMIN_TOKEN" | jq

# 2) 抓个网页
curl -s http://localhost:3001/api/ingest/fetch-url \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","options":{"space":"知识中台","tags":["test"]}}' | jq
# → { jobId: "..." }

# 3) 看任务详情（带 phase + log）
curl -s http://localhost:3001/api/ingest/jobs/<jobId> \
  -H "authorization: Bearer $ADMIN_TOKEN" | jq

# 4) 沉淀对话
curl -s http://localhost:3001/api/ingest/conversation \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"title":"回归测试","messages":[{"role":"user","text":"你好"},{"role":"assistant","text":"我是助手"}]}' | jq
```

### 前端手验

打开 http://localhost:5173/ingest，过这些：

- [ ] 顶上 4 个 sub-tab 切得动：文件上传 / 网页抓取 / 对话沉淀 / 批量任务
- [ ] 右侧「入库配置」：
  - 目标空间下拉显示当前空间 + BookStack book 列表
  - 标签输入框可输入逗号分隔字符串
  - 分段策略 3 个 pill 互斥切换
  - 向量化 toggle 可点；默认开
- [ ] 文件上传 Tab：拖拽 / 点选都能触发 `/api/ingest/upload-full`，提交后下方队列出现新行
- [ ] 网页抓取 Tab：粘贴 URL → 点「抓取并入库」→ 队列出现 fetch-url 类型行
- [ ] 对话沉淀 Tab：「填入示例」按钮工作 → 提交后队列出现 conversation 类型行
- [ ] 任务队列：
  - 处理中 / 失败 / 完成 三个 badge 计数实时
  - 进度条随 phase 变化推进（pending 0% → parse 10% → ocr 25% → table 40% → chunk 60% → tag 75% → embed 95% → done 100%）
  - 「日志」按钮跳转 `/ingest/jobs/:id`
  - 「暂停」按钮调 `/api/ingest/jobs/:id/pause`，状态变「已暂停」
  - 「重试」按钮调 `/api/ingest/jobs/:id/retry`，状态回「排队」
- [ ] 详情页 `/ingest/jobs/:id`：
  - 顶上 PDF/Word/Excel/Markdown/OCR 标签里当前文件类型高亮
  - 6 步 stepper：done = 绿勾，active = 紫闪电，pending = 灰圈
  - 「正在 X」浅紫 panel 显示当前阶段 + 切片进度 / 平均 token
  - 完成后显示蓝色总结条：asset_id + chunks
  - 失败显示红色错误条
  - 运行日志区域实时刷新

### 自动化

```bash
# 前端单测（vitest 沙箱跑不了，要本机）
pnpm --filter web test src/knowledge/Ingest/index.test.tsx
# 期望 4/4 pass

# 双侧 tsc 已验过 EXIT=0
pnpm --filter qa-service exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
```

## 已知缺口 / followups

- **FU-1（暂停语义）** 当前 `pauseJob` 只改 phase 标记，`runIngestAndTrack` 不会真的中断（同步执行）。要做真暂停需把 ingestPipeline 改成可 abort 的 generator
- **FU-2（重试语义）** `retryJob` 只把 phase 重置为 pending；不会真的重新执行。前端要重提交才会触发
- **FU-3（细粒度 phase）** 当前 `runIngestAndTrack` 把 ingestDocument 当作"同步一气跑完"，6 步是粗粒度跳变。要看真实进度需在 ingestPipeline 内插 hook（`onPhaseStart('parse')` etc）
- **FU-4（持久化 jobs）** 进程重启清空。要持久化得新建 `ingest_job` 表
- **FU-5（fetch-url HTML 清洗）** 用了 regex strip；复杂页面（动态 JS 渲染）效果差。可换成 `cheerio` + `@mozilla/readability`
- **FU-6（conversation schema）** 当前接受 `[{role, text}]`；DSClaw 的 chat snapshot 格式还没对齐，需要 confirm
- **FU-7（任务队列分页）** 当前 limit 30 直接 list；超过会被截。要做无限滚动 / 分页
- **FU-8（数据接入页 vs 入库页）** 原型有「数据接入」独立页（`/mcp` 当前的位置）；入库页和数据接入是不同概念，本次只重做入库

## tsc 状态

- `apps/qa-service` `tsc --noEmit` EXIT=0 ✅
- `apps/web`        `tsc --noEmit` EXIT=0 ✅
