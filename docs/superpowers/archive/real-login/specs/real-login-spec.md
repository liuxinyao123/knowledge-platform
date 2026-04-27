# Spec: real-login

## Scenario: 首次启动 seed 默认 admin

Given users 表为空
When qa-service 启动
Then users 表出现 1 条 `admin@dsclaw.local / admin123 / roles=['admin']`
And console 打印警告

## Scenario: POST /login 成功

Given 用户 alice@x.com / 密码 secret123 / roles=['editor']
When POST /api/auth/login `{email:'alice@x.com', password:'secret123'}`
Then 200 + `{ token, user: {user_id, email, roles, permissions[]} }`
And token 能被 verifyToken 验通
And user.permissions 包含 `knowledge:ops:manage`
And user.permissions 不含 `iam:manage`

## Scenario: POST /login 密码错

When POST /api/auth/login 错密码
Then 401 + `{error:'invalid credentials'}`
And audit_log 写一条 `login_failed`（TODO：后续补）

## Scenario: POST /login 未配 secret

Given AUTH_HS256_SECRET 未设
When POST /api/auth/login
Then 500 + `{error:'login not configured'}`

## Scenario: 401 自动跳 /login

Given 前端有过期 token
When 访问任何 /api 端点
Then 响应 401 → 清 token → 浏览器跳 /login

## Scenario: RequireAuth 守卫

Given 未登录
When 访问 /overview
Then 跳 /login?from=/overview

## Scenario: editor 登录后看不到 IAM

Given editor 身份登录
When 渲染 Layout
Then 侧边栏管理组不显示
And 手动访问 /iam → 页面显示 "403 · 无权限"

## Scenario: 登出

When 已登录态点登出
Then token 从 localStorage 清除
And 跳 /login

## Scenario: POST /register ADMIN 专用

Given editor 身份登录
When POST /api/auth/register
Then 403

## Scenario: POST /password self 改密

Given 已登录
When POST /api/auth/password `{oldPassword, newPassword}`
Then 200
And 用新密码 login 成功 / 旧密码失败
