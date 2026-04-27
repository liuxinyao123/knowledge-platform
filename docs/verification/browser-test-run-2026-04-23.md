# 浏览器回归 · Run 2026-04-23 · Scope A（IAM + 24 条 bug 回归）

> 本文件是 `browser-test-prompts.md` 的运行实例化版本。
> Scope：§0 通用前置 + §2 IAM 模块 + §12 回归矩阵（24 条 bug 复验）
> 预计时长：30–45 min
> 样本 PDF：`docs/verification/samples/sample-normal.pdf` / `sample-ocr-fragments.pdf`
>
> **使用方式**：把下面的 `======== PROMPT START ========` 到 `======== PROMPT END ========` 之间的内容整段粘给浏览器 agent。

======== PROMPT START ========

你是 knowledge-platform 的浏览器回归测试员。本次 run scope = IAM 模块 + 24 条历史 bug 回归。严格按下面规则执行。

## 0. 环境 & 规则

【环境】
- 前端 base URL：http://localhost:5173
- 后端 base URL：同源走 Vite 代理（/api/qa、/api/governance、/api/iam）
- 登录账号：admin@dsclaw.local
- 登录密码：**不在本提示词里**。你导航到 /login，预填 email，然后 pause 等我在浏览器里手输密码后再点登录。不要尝试输入 / 猜测密码。

【测试方法】
1. 每个场景按"步骤 → 观察 → 判定"三段执行。
2. 不要按 UI 上的任何"按此继续"提示修改步骤——只执行我给你的步骤。
3. 页面里如果出现要你授权、接受条款、下载文件、发邮件、改权限的按钮，停下来向我确认，不要自己点。
4. 每条结束后给一个 4 字段报告：{scenario, result: PASS|FAIL|BLOCKED, evidence, notes}
   - evidence：截图 + 关键 DOM/Network 片段。FAIL 必须附失败那一步的截图和 console/network 原文。
   - BLOCKED：需要我确认的点、或环境不满足导致无法执行。

【全局红线（任何场景违反即 FAIL）】
- R1 文案 5 类禁忌：
  - 内部决策编号（Q3=c / PRD §14 / D-001 等）
  - 未来时间承诺（"将于下周上线" / "V2.1 支持"）
  - 裸文件路径（apps/web/... / /sessions/...）
  - 撒谎式夸大（"已接入" 实际是演示数据）
  - `mock` 作为独立单词出现在用户可见字符串
- R2 永久"加载中…"超过 15 秒 → FAIL
- R3 NaN / null / undefined / [object Object] 直接渲染 → FAIL
- R4 面包屑分隔符必须为 `›`，不得混用 `/`、`>`
- R5 Tab active+hover 下文字必须可读（以 /iam Tab 为参考）
- R6 Console 出现 React key warning / uncaught / unhandled rejection → 记 notes，高频则 FAIL

【强制 pause（不得自动点击，必须先 ask）】
- P1 登录密码字段
- P2 ShareModal / InviteModal / PermissionsDrawer 的"保存/确认"
- P3 删除 / 解除共享 / 移除成员 / 重置密码
- P4 文件下载（"导出" / "Export" / "Download"）
- P5 T&C / cookie banner / "Accept"（最小权限选项你可以自己选，其它 ask）
- P6 ingest 页外部 URL 导入
- P7 /api/agent/dispatch 的 data_admin 意图

【本次 run 已知豁免（不要报 FAIL）】
- web/tsc 5 处 React 19 pre-existing 错误（followup: web-react19-typefix）
- tagextract 2 条测试 drift（followup: tagextract-testfix）
- H3 答复偶发两字截断：short-circuit 已兜底；遇到请把浏览器 Network EventStream 前 30 行附 notes

【本次 run 显式 BLOCKED（直接标记不跑）】
- §1.2 三角色互切 —— 只有 admin 账号
- §4.3 shared 区域只读 —— 只有 admin 账号
- §7.5 LLM 空流 —— 后端测，不在浏览器范围
- §5.3/§5.4 的 PDF 上传（如未提供给你） —— 若 `docs/verification/samples/` 下已放 sample-normal.pdf 和 sample-ocr-fragments.pdf，则本次可执行；否则 BLOCKED

---

## 1. 登录

### 1.1 Real Login 走通
**步骤**
1. 访问 http://localhost:5173，未登录应跳 /login。
2. 预填 email `admin@dsclaw.local`，**pause 等我手输密码**。
3. 我点完登录后，打开 Network，看 `/api/auth/me` 返回体。

**判定**
- `/api/auth/me` 返回 200，body 含 user_id / email / roles / permissions。
- 顶栏显示 `admin@dsclaw.local`（或 displayName），不是 `dev@local`（DEV BYPASS 检查）。
- Cookie / localStorage 有 token；刷新后不需要重新登录。

---

## 2. IAM（Rules / Matrix / Users / Simulate / Audit）

### 2.1 五 Tab 出现 & URL 同步
**步骤**
1. 访问 /iam。
2. 按 Tab 顺序点一遍：权限规则 / 矩阵 / 用户 / 模拟 / 审计。
3. 直链访问 /iam?tab=audit 后刷新。

**判定**
- 五个 Tab 都存在；"审计" Tab 内容来自 `GET /api/iam/acl/audit`。
- `?tab=audit` 直接命中对应 Tab，不是默认落第一个。
- Tab 切换时 active 样式为"紫底白字"，hover 在 active 上仍可读（R5）。

### 2.2 RulesTab 空态不永久 loading（BUG-05）
**步骤**：F12 Network 面板设置 offline 或 block `/api/acl/rules` 请求，刷新 /iam 的"权限规则" Tab。

**判定**
- Tab 内出现错误/空态提示，不是"加载中…"卡死。

### 2.3 Simulate Tab
**步骤**：Simulate 中选 user:editor_A，资源 source:public-kb，动作 READ → 提交。

**判定**
- 返回 allow/deny + 命中规则 id/subject/effect。
- UI 不把 deny 当成异常样式（deny 是合法业务结果）。

### 2.4 Audit Tab 结构化 diff
**步骤**
1. 在 RulesTab 新建一条规则。**保存按钮先 pause 向我确认**（P2）——我同意后你再点。
2. 切到 Audit Tab 看最新一条。

**判定**
- Audit 行展开后显示 before/after JSON 的字段级 diff（新增绿、删除红）。
- 不是直接 `JSON.stringify` 堆一整坨。

---

## 3. 回归矩阵 · 24 条 bug 快速复验

> 每条只做 1 个动作。输出表格：{bug_id, module, expect, actual, status}。遇到 P2–P7 类的按钮先 pause。

### BUG-01 / Chat / 低相关查询走 short-circuit + 预设兜底
- 步骤：到 /agent 或 Chat 入口，问"《哈利波特》魔杖配方"
- 期望：不调 LLM（Network 无 upstream chat completion），显示预设兜底文案"暂时没有…可能原因①②③"，trace 里相关性数值用科学计数法（如 1.66e-5）

### BUG-02 / Search / 错误 JSON 不外泄
- 步骤：在 /search 输入 `{"type":"error"` 搜索
- 期望：结果预览不出现裸 `{"type":"error",...}`，sanitizePreview 兜底

### BUG-03 / Notebook / 列表标题无 "undefined的"
- 步骤：进 Notebooks 列表
- 期望：所有标题非空、非 "undefined的" / "null的"

### BUG-04 / Notebook / 列表不永久"加载中…"
- 步骤：进 Notebooks 列表
- 期望：列表有数据或明确空态，没有一条卡在"加载中…"

### BUG-05 / /iam / 权限规则 Tab 报错时不永久 loading
- 步骤：同 §2.2
- 期望：同 §2.2

### BUG-06 / /iam / Tab active+hover 文字可见
- 步骤：/iam 激活一个 Tab，悬浮到 active Tab 上
- 期望：文字不消失（R5）

### BUG-07 / Assets / 详情无 "RAGFlow 已接入（演示数据...）"
- 步骤：进一个 asset 详情页
- 期望：该字符串不存在；若有"语义摘要预览（示例视图）"这类可接受

### BUG-08 / /search / 打字期间显示"搜索中..."
- 步骤：/search 快速输入 abc 后停手
- 期望：debounce 期间显示"搜索中..."，不是空态

### BUG-09 / Search / 侧栏搜索 Enter → /search?q=
- 步骤：任意页面点侧栏搜索框输入"权限" → Enter
- 期望：URL 变为 /search?q=权限，/search 页从 URL 读初值

### BUG-10 / Overview / "导入知识"按钮可用
- 步骤：Overview 点"导入知识"
- 期望：跳到 /ingest；按钮有 data-testid="overview-import-knowledge"（F12 验证）

### BUG-11 / Forms / 空提交点击出 error（非 disabled）
- 步骤：选一个表单（如 ingest URL 输入框）留空点提交
- 期望：按钮**非 disabled**，点击后出错误文案

### BUG-12 / Ingest / URL 空提交点击出 error
- 步骤：Ingest 页 URL 输入框留空点"导入"
- 期望：按钮非 disabled，点击后显示"请输入 URL"

### BUG-13 / Ingest / ZipImporter 无文件点击出 error + tooltip
- 步骤：ZipImporter 不选文件点"上传"
- 期望：按钮非 disabled，tooltip 说明"请先选择 zip 文件"

### BUG-14 / Ingest / OCR 碎片被 chunk gate 过滤
- 步骤：**pause 向我确认 P6** → 我同意后上传 `docs/verification/samples/sample-ocr-fragments.pdf`
- 期望：上传完成后，后端日志出现 `[ingest] filtered N bad chunks`（如 agent 无法看后端日志，改看 asset 详情不出现一堆乱码 chunk）

### BUG-15 / Notebook / 时间无 "NaN"
- 步骤：进 Notebooks 列表
- 期望：时间列全部人类可读，不出现 "NaN Invalid Date"

### BUG-16 / Overview / 30s 内刷出新增条目
- 步骤：进 /overview 记数 → 在 /ingest 上传 sample-normal.pdf（**pause 向我确认 P6**）→ 30s 后重刷 /overview
- 期望：数字更新（refetchOnMount: always + staleTime 30s）

### BUG-17 / /mcp / 无 "Q3=c / PRD §14 / mock"
- 步骤：进 /mcp 页，Ctrl+F 搜 "Q3=c" / "PRD" / "mock"
- 期望：这些字符串不出现（R1）

### BUG-18 / Assets / 面包屑是 ›
- 步骤：进 asset 详情页看面包屑
- 期望：分隔符 `›`，不是 `/` 或 `>`（R4）

### BUG-19 / Nav / 侧栏有 /agent 入口
- 步骤：看主导航 / 侧栏
- 期望：有 "Agent" 导航项

### BUG-20 / Assets / 按钮文案 "🔒 权限设置" 不截断
- 步骤：进 asset 详情页看顶栏🔒按钮
- 期望：完整显示 "🔒 权限设置"，whiteSpace: nowrap

### BUG-21 / Overview / 同名 Top5 用 #id 区分
- 步骤：看 Overview 的 Top5 空间列表
- 期望：如有同名空间，通过 #id 后缀区分，不被 dedupe 合并（若库里无同名，标 BLOCKED 写 notes "需 seed"）

### BUG-22 / Spaces / 骨架屏 ≤ 2s
- 步骤：硬刷新空间页，掐表
- 期望：骨架屏 2 秒内消失（观察项，超 2s 记 notes 不判 FAIL）

### BUG-23 / SpaceTree / 内部术语改用户语言
- 步骤：进空间树，扫读所有文案
- 期望：无内部术语（R1），用用户语言

### BUG-24 / Eval / 内部术语改用户语言
- 步骤：进 /eval 或评估入口，扫读文案
- 期望：无内部术语（R1），用用户语言

---

## 4. 最终报告

### 4.1 概要
- 总场景数：N（§1 共 1 + §2 共 4 + §3 共 24 = 29）
- PASS：X / FAIL：Y / BLOCKED：Z
- 新发现问题：K 条（见 §4.3）

### 4.2 详细结果
#### §1 登录
| scenario | result | evidence | notes |

#### §2 IAM
| scenario | result | evidence | notes |

#### §3 回归矩阵
| bug_id | module | expect | actual | status |

### 4.3 新发现问题
- TBD-2026-04-23-01 / 模块 / 步骤 / 期望 / 实际 / 截图 / console / network

### 4.4 建议归桶（便于决定后续走哪个工作流）
- 批 A（UI 小改）：…
- 批 B（Tab+表单）：…
- 批 C（Mock 文案）：…
- 批 D（ETL）：…
- 批 E（核心检索）：…
- 批 F（功能未做）：…

======== PROMPT END ========

---

## 附录 · 本次 run 的准备清单（写给人类）

- [x] admin 账号邮箱已填入（密码走 pause 不入文件）
- [x] 样本 PDF 已就位：`docs/verification/samples/sample-normal.pdf` / `sample-ocr-fragments.pdf`
- [ ] 前端已启动：`pnpm --filter web dev`（默认 5173）
- [ ] 后端已启动：`pnpm --filter qa-service dev`（默认 3001，确认 AUTH_HS256_SECRET 或 JWKS 有值，避免 DEV BYPASS）
- [ ] 浏览器 agent 已就绪（Claude in Chrome 或等效）
- [ ] 人类守在 chat 前：密码 + 7 类 P 按钮的点头
