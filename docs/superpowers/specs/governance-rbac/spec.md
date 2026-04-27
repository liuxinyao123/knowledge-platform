# Spec: 用户权限体系

## GET /api/governance/users

**Scenario: 返回合并后的用户列表**
- Given BookStack `/api/users` 返回用户 [{id:1, name:"A", email:"a@x.com"}]
- And `knowledge_user_roles` 中 user_id=1 的 role='editor'
- When 调用 GET /api/governance/users
- Then 响应 `{ users: [{ id:1, name:"A", email:"a@x.com", role:"editor" }] }`

**Scenario: 无记录时角色默认 viewer**
- Given BookStack 返回用户 [{id:2, name:"B", email:"b@x.com"}]
- And `knowledge_user_roles` 无 user_id=2 的记录
- When 调用 GET /api/governance/users
- Then 响应 `{ users: [{ id:2, name:"B", email:"b@x.com", role:"viewer" }] }`

---

## PUT /api/governance/users/:id/role

**Scenario: 更新已有用户角色**
- Given user_id=1 在 DB 中已有 role='viewer'
- When PUT /api/governance/users/1/role body `{ role: "editor" }`
- Then DB 中 user_id=1 的 role 更新为 'editor'
- And 调用 BookStack PUT /api/users/1 with `{ roles: [2] }`
- And 响应 `{ ok: true }`

**Scenario: 首次写入用户角色**
- Given user_id=5 在 DB 中无记录
- When PUT /api/governance/users/5/role body `{ role: "admin" }`
- Then DB 中插入 user_id=5 role='admin'
- And 调用 BookStack PUT /api/users/5 with `{ roles: [1] }`
- And 响应 `{ ok: true }`

**Scenario: 角色值非法**
- When PUT /api/governance/users/1/role body `{ role: "superuser" }`
- Then 响应 400 `{ error: "invalid role" }`

---

## GET /api/governance/shelf-visibility

**Scenario: 返回合并后的书架可见性**
- Given BookStack `/api/shelves` 返回 [{id:10, name:"产品"}]
- And `knowledge_shelf_visibility` 中 shelf_id=10 visibility='team'
- When 调用 GET /api/governance/shelf-visibility
- Then 响应 `{ shelves: [{ id:10, name:"产品", visibility:"team" }] }`

**Scenario: 无记录时可见性默认 public**
- Given BookStack 返回 [{id:11, name:"技术"}]
- And `knowledge_shelf_visibility` 无 shelf_id=11 的记录
- When 调用 GET /api/governance/shelf-visibility
- Then 响应 `{ shelves: [{ id:11, name:"技术", visibility:"public" }] }`

---

## PUT /api/governance/shelf-visibility/:id

**Scenario: 更新书架可见性**
- When PUT /api/governance/shelf-visibility/10 body `{ visibility: "private" }`
- Then DB UPSERT shelf_id=10 visibility='private'
- And 响应 `{ ok: true }`

**Scenario: 可见性值非法**
- When PUT /api/governance/shelf-visibility/10 body `{ visibility: "secret" }`
- Then 响应 400 `{ error: "invalid visibility" }`

---

## 前端：MembersTab

**Scenario: 初始加载显示用户列表**
- Given govApi.getUsers 返回 [{id:1, name:"A", role:"admin"}]
- When MembersTab 渲染
- Then 显示用户名 "A"
- And 角色下拉默认选中 "admin"

**Scenario: 更新角色成功提示**
- Given 用户点击角色下拉选 "editor"
- And 点击「保存」
- When govApi.updateUserRole 返回 { ok: true }
- Then 显示成功提示文案

---

## 前端：SpacesTab（空间权限）

**Scenario: 初始加载显示书架列表**
- Given govApi.getShelfVisibility 返回 [{id:10, name:"产品", visibility:"team"}]
- When SpacesTab 渲染
- Then 显示书架名 "产品"
- And 可见性下拉默认选中 "team"

**Scenario: 保存可见性**
- Given 用户选择 "private" 并点击「保存」
- When govApi.updateShelfVisibility 返回 { ok: true }
- Then 显示成功提示文案
