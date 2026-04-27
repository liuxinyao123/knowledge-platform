# Spec: DSClaw UI 重构行为规格

## Design Token

**Given** 应用加载
**When** DOM 渲染
**Then** `:root` 包含 `--p: #6C47FF`，body font-family 包含 `PingFang SC`

## KnowledgeTabs

**Given** 用户位于 /overview 路由
**When** KnowledgeTabs 渲染
**Then** 「总览」tab 处于 active 态（有 data-active="true" 或 active class）

**Given** 用户点击「检索」tab
**When** 点击事件触发
**Then** 路由跳转至 /search

## Search — 防抖与最短查询长度

**Given** 搜索框内容为 1 个字符
**When** 300ms 后
**Then** bsApi.search 不被调用

**Given** 搜索框内容 >= 2 个字符
**When** 300ms 防抖结束
**Then** bsApi.search 被调用一次，参数为当前输入值

**Given** 用户快速连续输入 3 次
**When** 最后一次输入后 300ms
**Then** bsApi.search 只被调用一次（防抖生效）

## Search — 结果渲染

**Given** bsApi.search 返回结果列表
**When** 渲染完成
**Then** 每个结果显示 name 和 preview_html.content

**Given** bsApi.search 返回空数组
**When** 渲染完成
**Then** 显示 empty-state（含空态文字）

**Given** 用户点击一个搜索结果
**When** 点击事件触发
**Then** 右侧预览区更新为该结果的 name 和 preview_html

## Search — 收藏

**Given** 用户在预览区点击「⭐ 收藏」
**When** 点击事件触发
**Then** 该 page 的 id 被写入 localStorage['kc_favorites']

## QA — 发送消息

**Given** 用户在输入框填写内容并点击「发送」
**When** 点击事件触发
**Then** POST /api/qa/ask 被调用，请求体含 question 字段

**Given** POST /api/qa/ask 返回成功
**When** 响应完成
**Then** AI 回答气泡出现在 chat-log 中

**Given** POST /api/qa/ask 网络失败
**When** 请求失败
**Then** 聊天区显示错误提示，不抛出未捕获异常

## Ingest — 上传区

**Given** 用户拖入一个 .md 文件
**When** drop 事件触发
**Then** 文件名显示在上传区

**Given** 用户点击「上传」且已选择文件和 Book
**When** 点击事件触发
**Then** bsApi.createImport 被调用

## Ingest — 步骤轮询

**Given** createImport 调用成功返回 importId
**When** 轮询开始
**Then** bsApi.pollImport(importId) 被周期性调用（间隔 2s）

**Given** bsApi.pollImport 返回 status=complete
**When** 轮询结果到达
**Then** 最后一步变为完成态，轮询停止

## Governance — 角色保存

**Given** 用户修改某用户的角色为 admin
**When** 点击「保存」
**Then** localStorage['kc_user_roles'] 包含该用户的角色记录

**Given** 用户点击「同步至 BookStack」
**When** 点击触发
**Then** bsApi.updateUserRoles 被调用，参数含 userId 和角色 id 数组
