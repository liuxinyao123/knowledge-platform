# Spec: permissions-drawer（F-2 Spaces/Assets 权限抽屉）

## 入口

**Scenario: SpaceTree 行级入口**
- Given SpaceTree 渲染一行 source#7
- And 当前用户有 `iam:manage`
- Then 该行 kebab 菜单包含「权限…」项

**Scenario: 无 iam:manage 不显示入口**
- Given 当前用户无 `iam:manage`
- Then SpaceTree 行的 kebab 无「权限…」

**Scenario: Assets/Detail 顶栏入口**
- Given 打开 /assets/42
- And 当前用户有 `iam:manage`
- Then 顶栏出现「权限…」按钮

---

## PermissionsDrawer 行为

**Scenario: 打开 source 抽屉**
- Given 点「权限…」on source#7
- Then 抽屉打开；标题包含 'source#7 <source.name>'
- And 列表 GET /api/acl/rules?source_id=7

**Scenario: 打开 asset 抽屉**
- Given 点「权限…」on asset#42
- Then 抽屉标题含 'asset#42'
- And 列表 GET /api/acl/rules?asset_id=42

**Scenario: 列表展示字段**
- Given 后端返 3 条规则
- Then 表格列 `主体 | permission | effect | 过期`
- And 主体按 subject_type 显示徽标（"role: editor" / "team: 3" / "user: alice@corp.com"）

**Scenario: 新增规则预填 source_id**
- Given 在 source#7 抽屉点「+ 新增规则」
- Then 弹表单；source_id 字段被预填为 7 且 disabled
- And asset_id 字段为空且 disabled

**Scenario: 新增规则预填 asset_id**
- Given 在 asset#42 抽屉点「+ 新增规则」
- Then asset_id 预填 42 且 disabled；source_id 为空且 disabled

**Scenario: 提交后刷新**
- Given 用户在抽屉提交新规则成功
- Then 抽屉内列表重新拉 /api/acl/rules
- And 新规则出现在列表顶部

**Scenario: 删除规则**
- Given 用户在抽屉点某条规则的「删除」
- Then 调 DELETE /api/acl/rules/:id
- And 列表刷新

**Scenario: 抽屉关闭不影响全局**
- Given 用户关闭抽屉（无保存）
- Then /iam?tab=rules 数据不受影响（仍然是 DB 真实状态）

---

## 抽屉作用域限制（安全约束）

**Scenario: 抽屉不允许修改全局规则**
- Given 某条规则 `{source_id:NULL, asset_id:NULL}`（全局）
- When 抽屉尝试展示或编辑该规则
- Then 抽屉列表**不显示**该规则（只显示本资源域内的规则）
- And 点「+ 新增规则」也无法构造 source_id=NULL 的请求

**Scenario: 抽屉提交时后端校验**
- Given 某用户篡改前端请求去掉预填的 source_id
- When POST /api/acl/rules 不带 source_id 也不带 asset_id
- Then 本抽屉**不应该**能触发该请求（前端校验 + form disabled）；即便绕过也由后端 ADMIN 门拦住（该场景已是 /iam 全局管理的权限边界）

---

## 复用 RulesTab 组件

**Scenario: 主体选择器 / effect / expires_at 组件与 RulesTab 一致**
- Given 打开抽屉的新增规则表单
- Then 字段集与 /iam?tab=rules 的新增表单完全一致（复用同一个 React 组件）
- And 样式 / 行为 / 校验都一致

**Scenario: hook useRuleMutations 单一数据源**
- Given RulesTab 和 PermissionsDrawer 都用 useRuleMutations
- When 在抽屉里新增规则
- Then /iam?tab=rules 下次打开看到相同规则；不存在"抽屉规则"与"规则页规则"两套

---

## 无障碍与交互

**Scenario: ESC 关抽屉**
- Given 抽屉打开
- When 按 ESC
- Then 抽屉关闭（未提交的表单需要二次确认提示）

**Scenario: 焦点陷阱**
- Given 抽屉打开
- Then Tab 键循环焦点在抽屉内；首焦落在「+ 新增规则」按钮
