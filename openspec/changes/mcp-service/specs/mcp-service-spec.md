# Spec: 知识中台 MCP 服务

## search_knowledge

**Scenario: 基本搜索返回结果列表**
- Given BookStack `/api/search` 返回 [{name:"Doc A", type:"page", url:"http://bs/p/1", preview_html:{content:"<p>Hello</p>"}, book:{id:1,name:"技术库"}}]
- When 调用 search_knowledge {query:"Hello", count:10}
- Then 响应 {results:[{name:"Doc A", excerpt:"Hello", url:"http://bs/p/1", type:"page", book_name:"技术库"}]}

**Scenario: excerpt 去除 HTML 标签**
- Given preview_html.content = "<b>加粗</b> 内容"
- When search_knowledge 处理该结果
- Then excerpt = "加粗 内容"

**Scenario: shelf_id 过滤——有匹配**
- Given shelf_id=5，`/api/shelves/5` 返回 books:[{id:10},{id:11}]
- And 搜索结果包含 book.id=10 的页面和 book.id=99 的页面
- When 调用 search_knowledge {query:"X", shelf_id:5}
- Then 仅返回 book.id=10 的页面（book.id=99 的被过滤）

**Scenario: shelf_id 过滤——无匹配**
- Given shelf_id=5，搜索结果全部属于 book.id=99
- When 调用 search_knowledge {query:"X", shelf_id:5}
- Then 返回 {results:[]}

**Scenario: count 默认值**
- When 调用 search_knowledge {query:"X"}（未传 count）
- Then BookStack 请求的 count 参数为 10

---

## get_page_content

**Scenario: 正常返回页面内容**
- Given `/api/pages/42` 返回 {name:"架构设计", html:"<p>内容</p>", url:"http://bs/p/42", tags:[{name:"技术"},{name:"架构"}], updated_at:"2026-04-01T10:00:00Z"}
- When 调用 get_page_content {page_id:42}
- Then 响应 {name:"架构设计", content:"内容", url:"http://bs/p/42", tags:["技术","架构"], updated_at:"2026-04-01T10:00:00Z"}

**Scenario: content 去除 HTML 标签**
- Given html = "<h1>标题</h1><p>段落</p>"
- When get_page_content 处理
- Then content = "标题 段落"

**Scenario: content 截断至 10000 字符**
- Given html 转纯文本后超过 10000 字符
- When get_page_content 处理
- Then content.length <= 10000

**Scenario: 空 tags**
- Given 页面无 tags 字段（或为 []）
- When get_page_content 处理
- Then tags = []
