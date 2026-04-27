# Spec: Skill Loader & Declarative Skill Framework

## Skill YAML 解析

**Scenario: 最小合法 YAML 解析成功**
- Given `skills/x.skill.yaml` 内容含 `name/version/description/input/output/backend` 全部必填项
- When `loadAllSkills()` 扫描
- Then 返回结果包含一个 `LoadedSkill{ name:"x", version:1 }`

**Scenario: 缺少必填字段解析失败**
- Given YAML 缺 `input` 字段
- When `loadAllSkills()`
- Then 抛出 `SkillManifestError`，错误信息包含文件路径与缺失字段名

**Scenario: 同名 skill 重复 fatal**
- Given 两个文件都声明 `name: ontology.query_chunks`
- When `loadAllSkills()`
- Then 抛出 `SkillDuplicateError`，进程退出

**Scenario: hook import 失败跳过该 skill**
- Given `x.skill.yaml` 的 `backend.kind === 'hook'` 且 `x.hook.ts` 有语法错误
- When `loadAllSkills()`
- Then 该 skill 不在返回列表
- And 日志出现 `[skillLoader] WARN skip x: hook import failed`
- And 其他 skill 加载不受影响

---

## registerAll 与 MCP 集成

**Scenario: 每个 LoadedSkill 注册为 MCP tool**
- Given `skills = [ { name:"a" }, { name:"b" } ]`
- When `registerAll(server, skills)`
- Then MCP server 的 `listTools()` 返回包含 `a` 和 `b`
- And 调用 `callTool("a", input)` 会路由到对应 handler

**Scenario: Legacy tool 名字保持不变**
- Given YAML 含 `legacy_tool_name: search_knowledge`
- When `registerAll` 注册
- Then MCP tool name 为 `search_knowledge`（与文件名一致，即使 `name` 字段相同也不重复）

---

## backend.kind = http 行为

**Scenario: HTTP backend 正确映射 body**
- Given YAML 中 `body: { chunks: "{{ [{asset_id: input.asset_id, score: 1}] }}", maxHop: "{{ input.max_hop }}" }`
- And 输入 `{ asset_id: "a1", max_hop: 2 }`
- When handler 执行
- Then `proxyQaService` 收到的 body 为 `{ chunks: [{asset_id:"a1", score:1}], maxHop: 2 }`

**Scenario: HTTP backend 映射 response**
- Given YAML `response.map: { entities: "{{ response.entities }}", edges: "{{ response.edges }}" }`
- And qa-service 返回 `{ entities: [e1], edges: [], meta: {...} }`
- When handler 返回
- Then 输出为 `{ entities: [e1], edges: [] }`（不含 meta）

**Scenario: HTTP backend 超时**
- Given `proxyQaService` 超时（默认 5000ms）
- When handler 执行
- Then MCP 响应 `error.code === "timeout"`

**Scenario: HTTP backend 401**
- Given qa-service 返回 401
- When handler 执行
- Then MCP 响应 `error.code === "unauthorized"`

---

## backend.kind = hook 行为

**Scenario: hook 正常执行**
- Given YAML `backend.kind: hook` 且 `x.hook.ts` 导出 `run(input, ctx) => { result: input.q }`
- When 调用 tool `x` with `{q:"hi"}`
- Then MCP 响应 `{result: "hi"}`

**Scenario: hook 抛错包装为 MCP error**
- Given hook `run` 抛 `new Error("boom")`
- When 调用
- Then MCP 响应 `error.code === "skill_runtime_error"`，message 含 `"boom"`

---

## Auth 透传

**Scenario: auth.forward=true 透传 JWT**
- Given YAML `auth.forward: true`
- And MCP 请求头含 `Authorization: Bearer JWT_A`
- When handler 执行
- Then `proxyQaService` 发出的请求头 `Authorization: Bearer JWT_A`

**Scenario: auth.forward=false 使用服务账号 token**
- Given YAML `auth.forward: false`
- And 环境变量 `QA_SERVICE_SKILL_TOKEN=svc_xxx`
- When handler 执行
- Then `proxyQaService` 请求头 `Authorization: Bearer svc_xxx`

**Scenario: required_principal=admin 但调用方非 admin**
- Given YAML `auth.required_principal: admin`
- And MCP 请求未带有效 admin principal（由 qa-service 决定后返 403）
- When handler 执行
- Then MCP 响应 `error.code === "forbidden"`

---

## mcp-schema.json 一致性

**Scenario: schema:build 生成的 JSON 含所有 skill**
- Given `skills/` 下 8 个 YAML
- When 运行 `pnpm --filter mcp-service schema:build`
- Then `mcp-schema.json` 的 `tools` 数组长度 === 8
- And 每个 tool 的 `name` / `description` / `inputSchema` 与 YAML 一致

**Scenario: schema:check 发现漂移 fail**
- Given `mcp-schema.json` 少一个 skill
- When 运行 `pnpm --filter mcp-service schema:check`
- Then 退出码非 0
- And stderr 含 `schema drift detected`

---

## 向后兼容（search_knowledge / get_page_content）

**Scenario: search_knowledge I/O 与老版本完全一致**
- Given YAML + hook 迁移完成
- And BookStack mock 返回老版本测试中的数据
- When 调用 `search_knowledge {query:"Hello", count:10}`
- Then 输出结构与 `openspec/changes/mcp-service/specs/mcp-service-spec.md` 中原 Scenario 一致
- And 所有原 Scenario 的断言通过

**Scenario: get_page_content content 截断至 10000 字符**
- Given html 转纯文本后超过 10000 字符
- When 调用 `get_page_content {page_id:42}`
- Then `content.length <= 10000`

---

## Skill 契约摘要（每个新 skill 1 个 Scenario）

**Scenario: ontology.traverse_asset 返回 OntologyContext**
- Given `POST /api/ontology/context` mock 返回 `{entities:[e1], edges:[ed1], meta:{hop_depth:1, fallback:false}}`
- When 调用 `ontology.traverse_asset {asset_id:"a1", max_hop:1}`
- Then 输出 `{entities:[e1], edges:[ed1]}`

**Scenario: ontology.path_between 请求 max_depth clamp**
- Given 输入 `{from_id, to_id, max_depth: 99}`
- When 调用
- Then `proxyQaService` 请求 body 中 `maxDepth` 被 clamp 到 8 或 YAML 声明上限

**Scenario: action.execute 直通到 /api/actions/:name/run**
- Given `POST /api/actions/rebuild_index/run` mock 返回 `{run_id:"r1", state:"pending"}`
- When 调用 `action.execute {action_name:"rebuild_index", args:{asset_id:"a1"}, reason:"manual"}`
- Then 输出 `{run_id:"r1", state:"pending"}`

**Scenario: action.status 拉取运行状态**
- Given `GET /api/actions/runs/r1` mock 返回 `{run_id:"r1", state:"succeeded", attempts:1}`
- When 调用 `action.status {run_id:"r1"}`
- Then 输出 `{run_id:"r1", state:"succeeded", attempts:1}`
