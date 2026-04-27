# ADR 2026-04-23-21 · Bug Batch D + F（数据 ETL 4 条 + 功能未实现 3 条）

## Context

接 `2026-04-23-20-bugbatch-c.md`。两批合并做：批 D 的 4 条（数据/ETL）和批 F 的 3 条（功能未实现）。共 7 条 bug。

工作流：C `superpowers-feature-workflow`。

## Decision · 7 条修复

### 批 D · 数据/ETL

| Bug | 位置 | 根因 | 修复 |
|---|---|---|---|
| **BUG-02** 搜索结果暴露原始 JSON error | `apps/web/src/knowledge/Search/index.tsx` | 某次 ingest 异常时把 error JSON blob 当正文写进 BookStack；搜索时 `preview_html.content` 直接渲染给用户 | 加 `sanitizePreview(html)` —— 识别 `{"type":"error"}` / `"error":{...}` / `not_found_error` / `File not found in container` 等特征 → 替换为"（此文档因入库异常暂不可预览）"。两处渲染点（列表 + 预览面板）都套用 |
| **BUG-14** 标签里出现 "g g g"、"3" 中 🎯"、"BumperOrallyD" 等 OCR 碎片 | `apps/qa-service/src/services/tagExtract.ts::cleanOne` | LLM 有时会把 OCR 层残留的乱码直接当 tag 返回；`cleanOne` 仅做长度 / 标点过滤，没拦 OCR 模式 | 新增 `looksLikeOcrFragment(s)` 四条规则：含 emoji ❌ / 含裸引号 ❌ / 多 token 平均长度 < 2 ❌ / 单字符 token ≥ 3 个 ❌。插入 cleanOne 流水线 |
| **BUG-16** 总览统计数据不实时（5 分钟内不刷） | `apps/web/src/main.tsx:16` 全局 `staleTime: 5min` + `refetchOnWindowFocus: false` | 全局 5 分钟 stale + 不 refetchOnFocus。Overview 场景需要近实时（刚建了空间回首页就想看见） | **不动全局默认**（5 分钟是合理的 CRUD 默认）；Overview 的 4 个 useQuery 显式覆盖 `{ staleTime: 30_000, refetchOnMount: 'always' }` |
| **BUG-21** 活跃空间 Top5 出现两个同名"测试" | `apps/web/src/knowledge/Overview/index.tsx::activeShelves` 渲染 | BookStack 允许同名 shelf；不是 bug 是数据 | 不 dedupe（隐藏数据不对），而是**同名时追加 `#<id>` 后缀**（`测试 #3`）；不同名不加 |

### 批 F · 功能未实现

| Bug | 位置 | 根因 | 修复 |
|---|---|---|---|
| **BUG-09** 侧栏搜索框按回车无反应 | `apps/web/src/components/Layout.tsx:96-110` | `<input>` 裸节点，没 state、没 onKeyDown | 抽出新组件 `<SidebarSearch>`：`useState` 管 query + onKeyDown Enter → `navigate('/search?q=<encoded>')`；空串不跳转。`Search/index.tsx` 相应补 `useSearchParams` 读 `?q=` 做初始值 |
| **BUG-10** 总览"导入知识"按钮无反应 | `apps/web/src/knowledge/Overview/index.tsx:112` | **代码层正确** —— `onClick={() => navigate('/ingest')}` 有效，侦查不到前端根因 | 本轮**未改行为**，加 `data-testid="overview-import-knowledge"` 方便本机 F12 + React DevTools 确认事件绑定；若持续复现，需抓 console / network |
| **BUG-22** 空间加载初始骨架屏 2s | `apps/web/src/knowledge/SpaceTree/*` | 首次 fetch 真就 ~2s（BookStack API 慢 + 多 query 串行） | **性能观察非 bug**，本轮不改代码。建议独立做一轮 perf change：骨架屏 + stale-while-revalidate + BookStack 代理缓存 |

## 设计决策

### BUG-02 · 为什么前端做防御而不是 ingest 层

**ingest 层过滤** 是根治方式（"顶层带 error key 的 JSON body" 不该入库）。但：
1. 改 ingest 要等下一轮 ETL change（批 D 之外）
2. DB 里已经有脏数据，不加前端防御的话改 ingest 也管不到历史
3. 前端防御 4 行代码，立即见效

最佳方案：**前端现在做防御 → ingest 层未来做过滤 + 一次性清理脚本**。本批只做前 1/3；后 2/3 列 Follow-up。

### BUG-14 · 为什么不删 OCR 碎片而是整体丢弃

曾考虑"把 `g g g` 清理成 `ggg`" —— 但这是**瞎猜用户本意**。OCR 层本身就不可信，与其"还原"一个不存在的词，不如直接丢掉这个 tag，让文档少 1 个 tag 而不是多 1 个错的 tag。

### BUG-16 · 为什么不改全局 staleTime

全局 5 分钟是合理默认（避免 IAM / 治理页来回切换不必要的 fetch）。只在 Overview 场景覆盖为 30s，因为"总览"心智是近实时。后续若发现别的页也需要近实时（e.g. Assets），按需单独覆盖。

## tsc 闸门

- qa-service `tsc --noEmit`：**EXIT=0** ✅
- web `tsc --noEmit --project tsconfig.app.json`：**EXIT=2**，5 条错误全部 pre-existing（`RunDetail.tsx` / `ChatPanel.tsx`，React 19 遗留，独立 `web-react19-typefix`）；**本批 0 新错**

## Follow-ups（不阻塞本轮归档）

| 项 | 建议工作流 | 备注 |
|---|---|---|
| BUG-02 ingest 层过滤 "error JSON body" + 一次性 SQL 清理脚本 | B | 碰数据模型边界，上 OpenSpec 稳一点 |
| BUG-10 若持续复现 | C | 让用户本机贴 console / network tab；若是 React 渲染异常，按根因修 |
| BUG-22 Space 首屏性能优化（stale-while-revalidate / 服务端缓存） | C | 单独 perf 改动 |
| 批 E · BUG-01 核心检索 reranker 0 分 + 回答截断 | B · 新会话 | 工程量最大，单独 Explore |

## Links

- 上一轮：`2026-04-23-20-bugbatch-c.md`
- 改动文件：
  - 后端：`apps/qa-service/src/services/tagExtract.ts`
  - 前端：`apps/web/src/components/Layout.tsx` · `knowledge/{Search/index,Overview/index}.tsx`
