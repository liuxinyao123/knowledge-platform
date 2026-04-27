# Spec: notebook-sharing（直授 + 团队授 + accessibility + members CRUD）

## accessibility 计算

**Scenario: owner 恒可见**
- Given notebook#10 owner_user_id = principal.user_id
- Then loadAccessibleNotebook → allow；访问标签 'owner'

**Scenario: user 直授**
- Given notebook_member 有一行 `{notebook_id:10, subject_type:'user', subject_id:'alice@corp.com', role:'viewer'}`
- And principal.email = 'alice@corp.com'
- Then allow；访问标签 'shared-direct'

**Scenario: team 授权**
- Given notebook_member 有 `{notebook_id:10, subject_type:'team', subject_id:'3', role:'reader'}`
- And principal.team_ids = ['3']
- Then allow；访问标签 'shared-team'

**Scenario: 既非 owner 也未受任何直授 / 团队授**
- Given 以上条件都不满足
- Then 403 notebook_not_accessible

---

## GET /api/notebooks 分段返回

**Scenario: 返回结构**
- Given principal 有 2 个自己拥有的 notebook + 3 个共享给他/团队的 notebook
- When GET /api/notebooks
- Then response = `{ items: [...2 条 owner], shared: [...3 条共享] }`

**Scenario: 同一 notebook 既 owner 又是 team 成员**
- Given principal 是 notebook#10 owner；团队 3 也被共享了 notebook#10
- Then items 含 10；shared 不重复 10

**Scenario: 空态**
- Given principal 无任何 notebook
- Then response = `{ items: [], shared: [] }`（两个 key 都存在）

---

## members CRUD（GET/POST/DELETE /api/notebooks/:id/members）

**Scenario: 列出成员（owner 或 member 可见）**
- Given principal 是 notebook#10 的 member
- When GET /api/notebooks/10/members
- Then 200，返回 members[] 列表，每项 `{subject_type, subject_id, role, display_name?}`

**Scenario: 添加成员（仅 owner 允许）**
- Given principal 不是 owner
- When POST /api/notebooks/10/members body `{subject_type:'user', subject_id:'bob@corp.com', role:'viewer'}`
- Then 403 only_owner_can_share

**Scenario: owner 添加成员成功（upsert 语义）**
- Given principal 是 owner
- When POST /api/notebooks/10/members body `{subject_type:'user', subject_id:'bob@corp.com', role:'reader'}`
- Then 201 `{ok: true}` + INSERT notebook_member
- And 若 (notebook_id, subject_type, subject_id) 已存在 → ON CONFLICT DO UPDATE role = EXCLUDED.role（**不返 409**）

**Scenario: POST 未带 subject_id**
- Given body 缺 subject_id
- Then 400 `{error: 'subject_id required'}`

**Scenario: POST subject_type=user 但 subject_id 不是邮箱**
- Given body `{subject_type:'user', subject_id:'not-email'}`
- Then 400 `{error: 'subject_id must be a valid email when subject_type=user'}`

**Scenario: 删除成员走路径参数（仅 owner 允许）**
- Given principal 不是 owner
- When DELETE /api/notebooks/10/members/user/bob@corp.com
- Then 403（loadOwnedNotebook 返 404/403 — 以现网实现为准）

**Scenario: owner 正常删成员**
- Given principal 是 owner 且成员存在
- When DELETE /api/notebooks/10/members/user/bob@corp.com
- Then 200 `{ok: true, removed: 1}`

**Scenario: owner 不是 notebook_member 行（owner_user_id 不走 notebook_member）**
- Given owner 身份由 `notebook.owner_user_id` 记录，非 `notebook_member` 行
- Then 即便所有 member 行都被删，owner 本人仍可访问（accessibility 规则里 owner 分支独立）

---

## notebook_member.role 语义

**Scenario: role 字段归一化**
- Given POST /api/notebooks/:id/members body `{role: 'random'}`
- Then 后端归一化为 'reader'（现网实现：`role === 'editor' ? 'editor' : 'reader'`）；不返 400
- And 只有 body.role === 'editor' 才会落库为 'editor'

**Scenario: role 含义独立于系统角色**
- Given principal.roles = ['viewer']（系统角色）
- And notebook_member.role = 'editor'（协作角色）
- Then 该 principal 在该 notebook 内按 editor 协作角色行事（具体写权限由后续 change 扩；本 change 只冻结"是否可见"和"协作角色 enum ∈ {editor, reader}"）

---

## 前端「共享给我的」区段

**Scenario: Notebooks index 两段式**
- Given GET /api/notebooks 返回 items + shared
- Then UI 显示「我的」(items) 和「共享给我的」(shared) 两个分区
- And shared 每项头部带 access 徽标（shared-direct / shared-team）

**Scenario: ShareModal 可选择 user 或 team**
- Given owner 打开 Detail 的 ShareModal
- Then 主体选择器包含 'user' / 'team' 两类
- And team 下拉列出当前 DB 中所有团队
