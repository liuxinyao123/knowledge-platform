# Spec: acl-v2（三类主体 + deny + TTL + 双轨种子）

## subjectMatches（evaluateAcl.ts）

**Scenario: role 主体匹配**
- Given rule `{subject_type:'role', subject_id:'editor'}`
- And principal.roles = ['editor']
- Then subjectMatches === true

**Scenario: role 主体不匹配**
- Given rule `{subject_type:'role', subject_id:'editor'}`
- And principal.roles = ['viewer']
- Then subjectMatches === false

**Scenario: role 通配**
- Given rule `{subject_type:'role', subject_id:'*'}`
- And principal.roles = ['viewer']
- Then subjectMatches === true

**Scenario: user 主体按 email 精确匹配**
- Given rule `{subject_type:'user', subject_id:'alice@corp.com'}`
- And principal.email = 'alice@corp.com'
- Then subjectMatches === true

**Scenario: team 主体按 principal.team_ids 匹配**
- Given rule `{subject_type:'team', subject_id:'3'}`
- And principal.team_ids = ['3', '7']
- Then subjectMatches === true

**Scenario: team 主体 principal 未入该团队**
- Given rule `{subject_type:'team', subject_id:'3'}`
- And principal.team_ids = ['7']
- Then subjectMatches === false

**Scenario: legacy 规则（subject_type=NULL）回退**
- Given rule `{subject_type:NULL, role:'editor'}`
- And principal.roles = ['editor']
- Then subjectMatches === true

**Scenario: legacy 规则 role=NULL 视为全员**
- Given rule `{subject_type:NULL, role:NULL}`
- And principal.roles = ['viewer']
- Then subjectMatches === true

---

## notExpired（evaluateAcl.ts）

**Scenario: 无 expires_at 恒真**
- Given rule `{expires_at:NULL}`
- Then notExpired === true

**Scenario: 过期时间在未来**
- Given rule `{expires_at: now + 7 days}`
- Then notExpired === true

**Scenario: 过期时间在过去**
- Given rule `{expires_at: now - 1 second}`
- Then notExpired === false

**Scenario: 过期规则不进 allow 也不进 deny**
- Given 一条 deny 规则过期 + 一条 allow 规则有效
- Then evaluateAcl → ALLOW（过期 deny 被 notExpired 过滤掉）

---

## deny 最高优

**Scenario: 单条 deny 命中即拒**
- Given principal.roles=['editor']
- And 规则集 `[{role:editor, allow READ}, {role:editor, deny READ}]` 都匹配
- When evaluateAcl(READ)
- Then DENY，reason 包含 "denied by rule(s) <id>"

**Scenario: 多条 deny 拼接 id**
- Given 两条 deny 都命中 id=10 / id=11
- Then reason 包含 "10,11"

**Scenario: 无 deny + 有 allow 通过**
- Given 规则集只有一条 allow 命中
- Then ALLOW

**Scenario: 无 deny + 无 allow 默认拒绝**
- Given 无规则命中
- Then DENY（deny-by-default）

---

## asset 继承 source 的 ACL

**Scenario: asset 请求时父 source 的规则生效**
- Given rule `{source_id:7, asset_id:NULL, role:viewer, allow READ}`
- And 查询 asset#42（属于 source#7）
- Then evaluateAcl → ALLOW

**Scenario: asset 专属规则优先级与 source 规则同级**
- Given rule A `{source_id:7, asset_id:NULL, deny READ}` + rule B `{asset_id:42, allow READ}`
- Then DENY（deny 最高优仍生效，和 rule B 在同级评估）

---

## R-1 双轨种子（ensureDefaultAclRules）

**Scenario: 新装 DB（metadata_acl_rule 全空）只下发 admin**
- Given metadata_acl_rule 行数 = 0
- When 服务启动跑 ensureDefaultAclRules
- Then 仅插入 3 行：`subject_type=role, subject_id=admin, permission ∈ {READ, WRITE, ADMIN}, effect=allow`
- And 不插入任何 `subject_id='*'` 的行

**Scenario: 升级 DB（已存在老 * READ）保留不覆写**
- Given metadata_acl_rule 已有一行 `{subject_type:NULL 或 role, subject_id:'*', permission:'READ'}`
- When 服务启动跑 ensureDefaultAclRules
- Then 该老行保留不变
- And 仅当 admin READ/WRITE/ADMIN 缺失时才补齐
- And 启动日志 **WARN 一次** 提示 admin 去 `/iam?tab=rules` 手动收紧

**Scenario: 升级 DB 无老 * READ 但有其它规则**
- Given metadata_acl_rule 有其它业务规则但无 `subject_id='*'` 行
- When ensureDefaultAclRules
- Then 不 WARN；仅补齐 admin 三条（若缺）

**Scenario: 幂等**
- When ensureDefaultAclRules 重复运行 3 次
- Then metadata_acl_rule 行数不变；无重复 INSERT；无重复 WARN
