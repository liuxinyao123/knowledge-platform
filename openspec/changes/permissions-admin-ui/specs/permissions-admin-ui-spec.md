# Spec: permissions-admin-ui

## Scenario: admin 进入 /iam 看到 3 Tab

Given 当前用户 principal.roles 含 `admin`
When 访问 /iam
Then 看到 "规则 / 用户 / 权限矩阵" 三个 Tab，默认 "规则"

## Scenario: editor 访问 /iam 被拒

Given 当前用户 principal.roles = ['editor']
When 访问 /iam
Then 看到 403 / 无权限提示（RequirePermission 包的 fallback）

## Scenario: 新建规则 → 列表刷新

Given 在 /iam?tab=rules
When 点"+ 新建规则" → 填 permission="READ", role="editor" → 保存
Then 接口 `POST /api/acl/rules` 返 201；列表出现新行；audit_log 有 `acl_rule_create` 记录

## Scenario: Simulate 命中规则

Given 存在一条规则 `{role:'editor', permission:'READ', source_id:1}`
When 在 Simulate 面板输入 principal.roles=['editor'], action='READ', resource.source_id=1 → 点运行
Then 返 `{decision:{allow:true, matchedRules:[<id>]}}`

## Scenario: Simulate 未命中

Given 同上规则
When principal.roles=['viewer']（不含 editor）
Then 返 `{decision:{allow:false, reason:'no matching rule'}}`

## Scenario: 用户 Tab 列表包含 DEV BYPASS

Given DEV BYPASS 开启
When 打开 /iam?tab=users
Then 表格至少 4 行：当前 DEV BYPASS 身份 + 3 个 seed（alice/bob/carol）
And DEV BYPASS 行带"DEV"黄色标

## Scenario: 权限矩阵正确反映 ROLE_TO_PERMS

Given backend 的 ROLE_TO_PERMS 常量
When 打开 /iam?tab=matrix
Then `admin` 列包含 `iam:manage` 行的 ✓；`viewer` 列不含 `iam:manage` 行的 ✓
