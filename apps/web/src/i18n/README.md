# i18n · apps/web

react-i18next + i18next + i18next-browser-languagedetector，5 语言起步：

| code  | native      | 状态 |
|-------|-------------|------|
| zh-CN | 简体中文    | ✅ 默认源语言 |
| en    | English     | ✅ 全量翻译（Notebook 模块） |
| ja    | 日本語      | 🟡 骨架，fallback en/zh |
| ko    | 한국어      | 🟡 骨架，fallback en/zh |
| vi    | Tiếng Việt  | 🟡 骨架，fallback en/zh |

## 用法

```tsx
import { useTranslation } from 'react-i18next'

function MyComponent() {
  const { t } = useTranslation('notebook')   // 当前 namespace
  return <div>{t('list.title')}</div>
  // 跨 namespace：t('common:actions.cancel')
}
```

## Namespace 拆分

| ns       | 范围 |
|----------|------|
| common   | 跨页面通用（按钮、状态、错误、占位符、language switcher 等）|
| notebook | Notebook 模块（NotebookList / Detail / Templates / Chat / Studio / Share）|
| 待加     | qa / search / kg / agent / governance / iam / eval / spaces / ingest / assets / mcp / overview / login / insights |

每加新模块时：
1. 在 `resources/zh-CN.json` 加 namespace block
2. 同步 `en.json`
3. `i18n/index.ts` 的 `ns: [...]` 加进去

## 添加新 key

1. 在 `resources/zh-CN.json` 对应 namespace 加 key
2. 复制到 `en.json` 翻译；`ja/ko/vi.json` 留空（自动 fallback）
3. 组件用 `t('namespace.path.to.key')`

## 添加新语言

1. `resources/<lang>.json`，复制 `zh-CN.json` 的结构，全部留空 `{}`（先 fallback）
2. `i18n/index.ts`：加 import + `resources` 里加一项 + `SUPPORTED_LANGUAGES` 加一行
3. 切换 widget 自动出现新选项

## fallback 策略

```
ja / ko / vi  ──>  en  ──>  zh-CN
zh-CN         ──>  zh-CN（终点）
en            ──>  zh-CN
```

未译 key 不会显示「key 路径字符串」，会自动回退到链上下一个语言。

## 持久化

切换语言写 `localStorage['dsclaw.i18n.lang']`，下次刷新沿用。
首次访问无值时按 `navigator.language` 兜底。

## 迁移路线图（按优先级）

### P0 ✅ 完成
- ✅ 基础设施 + 5 语言骨架（zh/en 完整 + ja/ko/vi 骨架）
- ✅ 顶部 Topbar 语言切换 widget
- ✅ Notebook 模块全量（N-006/7/8）：index.tsx / Detail.tsx / TemplateHintCard / CreateTemplateModal / MyTemplateActions

### P1 ✅ 完成（commit bc1c414）
- ✅ Layout / KnowledgeTabs / sidebar nav 全套（顶层导航）
- ✅ LanguageSwitcher widget
- ✅ Login（标题 / 表单 / 三档错误）
- ✅ Overview（标题 + 4 个 KPI metric card + 三块面板 + empty state + API down 错误页）
- ✅ components 共用件：ConfidenceBadge（4 档 + tooltip 插值）/ RewriteBadge / MarkdownView 图片 fallback

### P2-a 🔵 进行中
- ✅ Search 全量（commit 6170d86）—— filters 语义化 enum / 5 种 state / 预览面板含 typeLabel/bookPrefix/chapterPrefix 插值
- [ ] **QA**（102 行 CJK · 高频高复杂）—— index.tsx 主组件 + AssetDirectoryPanel + AnswerContent
  - 会话列表 / 推荐问 / Hero / 复合输入器 / SSE error 三档 / 引用面板 / 资产目录面板
  - 估计 ~100 个 key

### P2-b 待做
- [ ] Spaces (241 行 CJK / 14 文件 · 包含 SpaceTree / SpaceSourceTreePage)
- [ ] Ingest (411 行 / 19 文件 · 最大模块；含 IngestJob detail)
- [ ] Assets (198 行 / 5 文件 · catalog + Detail)
- [ ] Mcp (92 行 / 1 文件)

### P3 待做
- [ ] Governance (191 行 / 11 文件 · tags / duplicates / quality / auditLog)
- [ ] Iam (270 行 / 8 文件)
- [ ] Insights (86 行 / 8 文件)
- [ ] Eval (138 行 / 3 文件 · DatasetDetail / RunDetail)
- [ ] KnowledgeGraph (54 行 / 4 文件)
- [ ] Agent (45 行 / 2 文件)

### P4 待做
- [ ] auth/ 5 文件（38 行 · ChangePasswordModal / RequireAuth / RequirePermission 等）
- [ ] api/ 12 文件（83 行 · axios error message 透传，主要是 console / debug 文案；有部分用户可见）
- [ ] _shared/ 2 文件（50 行）
- [ ] Notebook 子组件深入：SourcesPanel / ChatPanel / StudioPanel / ShareModal（前次只覆盖了 5 个组件）
- [ ] IngestJob (7 行) / 各 *.test.tsx 中 describe/it 中文（不必动，dev-only）

### P5 数据层 i18n
- [ ] **System 模板 label / desc / starterQuestions i18n**：前端 useLocalizedTemplates hook 按 source==='system' + 当前语言用本地字典覆盖；长期方案 DB schema 加 label_i18n JSONB 列
- [ ] N-007 注册表 ARTIFACT_REGISTRY 中文 label
- [ ] 后端透传错误信息归一化（很多 4xx/5xx 的 error 是中文字面量，多语言下应改 i18n key 由前端翻译）

### P6 通用 i18n 完善
- [ ] 翻译 ja / ko / vi（先用 LLM 机器翻译初版，再人工校）
- [ ] 日期 / 数字 i18n（dayjs / Intl.NumberFormat / 货币 / 单位）
- [ ] RTL 支持（如未来加阿拉伯语）
- [ ] 错误页 / 404 / 500
- [ ] PageTitle hook（document.title 跟随语言）

## 当前进度统计

| 阶段 | 文件 | CJK 行 | 状态 |
|---|---|---|---|
| 基础设施 | 6 | — | ✅ |
| Notebook | 5 | ~200 | ✅ |
| P1 (Layout/Login/Overview/components) | 8 | ~200 | ✅ |
| P2-a Search | 1 | 46 | ✅ |
| P2-a QA | 3 | 147 | ✅ |
| P2-b Mcp | 1 | 92 | ✅ |
| P2-b Assets | 5 | 198 | ✅ |
| P2-b Spaces | 14 | 241 | 🟡 (2/14) |
| P2-b Ingest | 19 | 411 | ⏳ |
| P3 (Governance/Iam/Insights/Eval/KG/Agent) | 38 | ~784 | ⏳ |
| P4 (auth/api/Notebook 子组件/_shared) | ~25 | ~290 | ⏳ |
| P5 数据层 | — | ~80 | ⏳ |

**总进度：约 53% 全量完成**（已迁 ~1015/2000 CJK 行）。剩余按 P2-b 续 → P3 → P4 → P5 → P6 顺序推。

## 已 commit 的 i18n 系列（按时间顺序）

- `43da800` 基础设施 + Notebook 全量（commit ⑮）
- `bc1c414` P1 Layout/Nav/Login/Overview/components（commit ⑯）
- `6170d86` P2-a Search（commit ⑰）
- `1c14a24` P2-a QA + AssetDirectoryPanel + AnswerContent（commit ⑱）
- `cc8ebde` P2-b Mcp 全量（commit ⑲）
- `82cff23` P2-b Assets 5 文件全量（commit ⑳）
- `92d6ee3` P2-b Spaces 起步（index + CreateSpaceModal + 整套字典）（commit ㉑）

## 下次 session 接力清单

**P2-b Spaces 剩余 12 个文件**（字典已就位，对应 t() 引用即可）：
- AttachSourceModal / CreateSourceModal / EditSpaceModal
- PreviewPane / SpaceDetailPane / SpaceDirectoryList / SpaceInfoCard
- SpaceListPane / SpaceMembersTable / SpaceSourceTreePage / TreePane / types

**P2-b Ingest** 19 文件 / 411 行 CJK，最大模块。建议拆 2-3 个 commit：
- 第一片：index/Wizard/EmptyState/UploadTab/BatchTab/FetchUrlTab
- 第二片：FileQueue/FileSourceForm/FileSourceList/FileSourceLogDrawer
- 第三片：IngestConfigPanel/JobQueue/MetaForm/PreprocessingModule/PreviewPane/RecentImports/ZipImporter/ConversationTab

**P3** Governance / Iam / Insights / Eval / KG / Agent

**P4** auth / api / Notebook 子组件 / _shared

**P5** system 模板数据层 / 后端错误归一化

## 现已知 limitation

- **System 模板内容（label / desc / hint / starterQuestions）目前还是 DB 里的中文**：N-006 seed 时按 zh-CN 写入 `notebook_template` 表，没分语言列。短期方案：前端按 `source==='system'` 时用本地字典覆盖；长期方案：DB schema 加 `label_i18n JSONB` 列。本次未改。
- **后端错误信息**：`POST /api/templates` validate 失败时返回的 `errors` map 含中文字面值。多语言下应该返回 i18n key 让前端翻译。本次保持原样，前端直接显示后端原文。
- **alert / confirm 浏览器原生**：当前用 `window.confirm`，浏览器原生按钮（"确定/取消" or "OK/Cancel"）跟随系统语言而非应用语言。后续可换成自定义 ConfirmDialog。

## 安装

依赖已加到 `apps/web/package.json`：

```json
"i18next": "^23.16.0",
"i18next-browser-languagedetector": "^8.0.0",
"react-i18next": "^15.1.0"
```

第一次 pull 后跑：

```bash
cd ~/Git/knowledge-platform
pnpm install
pnpm --filter web dev
```
