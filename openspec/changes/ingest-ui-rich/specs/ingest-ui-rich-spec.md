# Spec: ingest-ui-rich

## Scenario: 单文件完整流程

Given 打开 /ingest （向导 Tab）
When 拖 1 个 .md 文件进队列
Then 该行 phase=pending
When 点"解析"
Then 行变 parsed；预览区显 markdown 文本
When 在右侧 tags 填 `财务,2026` 并 [应用]
Then 行的 tags 更新
When 选知识库，点"提交全部"
Then 行 phase=done；Recent Imports 列表出现此条

## Scenario: 多文件混合类型

Given 队列里 3 个文件：.md / .pdf / .dwg
When 点"解析"
Then
- .md → parsed(text)
- .pdf → parsed(text)
- .dwg → parsed(attachment, hint)

When 提交全部
Then 3 条都 done；createPageWithAttachment 只在 .dwg 路径走

## Scenario: 一条失败不影响其它

Given 队列 2 条，第 1 条解析后端 5xx
When 点提交
Then 第 1 条 failed + 红色 error；第 2 条继续 done

## Scenario: Recent Imports 点击跳转

Given Recent Imports 里有 target_type=asset target_id=137
When 点该行的"详情"按钮
Then 路由跳到 /assets/137

## Scenario: ZIP Tab 保留

Given 在 /ingest 切到 [ZIP 批量] Tab
When 上传 .zip 并选 book
Then 调 /api/bookstack 导入流程，进度用 useIngestPoller 展示（与旧行为一致）
