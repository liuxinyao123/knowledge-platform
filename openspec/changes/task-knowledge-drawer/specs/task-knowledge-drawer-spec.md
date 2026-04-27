# Spec: task-knowledge-drawer

## Scenario: semantic 模式返回相关 assets
Given qa-service 配置了 embeddings
When POST /api/knowledge/task-context { taskId:"T1", title:"供应商资质审核" }
Then 返 `{ mode:'semantic', relatedAssets: [<=5 条 with score] }`
And 第 1 条的 score > 第 5 条

## Scenario: fallback 模式
Given qa-service 未配置 embeddings
When POST /api/knowledge/task-context
Then 返 `{ mode:'fallback', relatedAssets 按 indexed_at DESC }`
And drawer 顶部黄条"演示数据"

## Scenario: drawer 渲染
Given /task-demo 页
When 输入 taskId="T1" / title="XXX" / 点加载
Then 右侧 Drawer 出现，Tab 1 默认
And 相关知识列表至少 1 条（非空库）或"无匹配"占位

## Scenario: 相关知识点击跳转
When 在 Drawer 相关知识里点"打开"
Then 路由跳 /assets/:id

## Scenario: 审计 Tab
When 切到操作记录 Tab
Then 列出最近 5 条包含 taskId 的 audit_log

## Scenario: 未登录访问 /api/knowledge/task-context
When 没 token 调该端点
Then 401

## Scenario: embedded=true
Given 组件传 embedded=true
Then 不带 fixed 定位；宽高由父容器控制
