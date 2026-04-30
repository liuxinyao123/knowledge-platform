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

### P0（本次完成）
- ✅ 基础设施 + 5 语言骨架
- ✅ 顶部 Topbar 语言切换 widget
- ✅ Notebook 模块全量（N-006/7/8）：index.tsx / Detail.tsx / TemplateHintCard / CreateTemplateModal / MyTemplateActions

### P1（下次 session 候选）
- [ ] Layout / KnowledgeTabs / sidebar nav（顶层导航）
- [ ] Login / RequireAuth / ChangePasswordModal（auth 流）
- [ ] Overview（首页）
- [ ] QA（最高频访问的页面之一）

### P2
- [ ] Search / KG / Agent / Governance
- [ ] Spaces / Ingest / Assets / Mcp
- [ ] Insights / Eval

### P3
- [ ] Notebook 子组件深入：SourcesPanel / ChatPanel / StudioPanel / ShareModal（本次未覆盖，因为 N-006 时间紧没改）
- [ ] **System 模板 label / desc / starterQuestions i18n**（这是数据层 i18n，需要前端字典覆盖 + 一个 useLocalizedTemplates hook，本次先用原文）
- [ ] 错误页 / 404 / 500
- [ ] 表单错误的后端错误信息归一化（很多后端中文 error 直接透传，多语言下需要 mapping）

### P4
- [ ] 翻译 ja / ko / vi（先用 LLM 机器翻译初版，再人工校）
- [ ] 日期 / 数字 i18n（dayjs / Intl.NumberFormat）
- [ ] RTL 支持（如未来加阿拉伯语）

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
