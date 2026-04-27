# Spec: user-admin

## Scenario: 新建用户
Given admin 登录
When POST /api/auth/register {email, password, roles} 或 UsersTab 点 "+ 新建用户" 填表提交
Then 201 + {id}
And 新行出现在 UsersTab

## Scenario: 改角色
Given 存在 editor 用户 bob
When PATCH /api/auth/users/:bob-id {roles:['viewer']}
Then 200
And GET /users 里 bob 的 roles 变 viewer
And bob 的 permissions 不再含 'knowledge:ops:manage'

## Scenario: 禁自降权
Given admin 登录
When PATCH /api/auth/users/<自己的 id> {roles:['viewer']}
Then 400 'cannot change own roles'

## Scenario: 删除用户
Given 存在 alice
When DELETE /api/auth/users/:alice-id
Then 200
And GET /users 不含 alice

## Scenario: 禁自删
Given admin 登录
When DELETE /api/auth/users/<自己的 id>
Then 400 'cannot delete self'

## Scenario: 管理员重置他人密码
Given editor bob 密码被忘
When ADMIN POST /api/auth/users/:bob-id/reset-password {newPassword:'new-pw-123'}
Then 200
And bob 可用 'new-pw-123' 登录
And bob 用旧密失败

## Scenario: 自助改密
Given 已登录
When POST /api/auth/password {oldPassword:旧, newPassword:新}
Then 200
And 用新密登成功 / 旧密 401
