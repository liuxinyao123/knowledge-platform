/**
 * V2 覆盖：subjectMatches（role/user/team/legacy）、notExpired、deny 最高优、asset 继承。
 * 对应 spec: openspec/changes/permissions-v2/specs/acl-v2-spec.md
 *
 * V1 语义由 auth.evaluateAcl.test.ts 覆盖；此处只补 V2 新增。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { __setRulesForTest, evaluateAcl } from '../auth/evaluateAcl.ts'
import type { AclRuleRow, Principal } from '../auth/types.ts'

const editor: Principal = {
  user_id: 1, email: 'e@x.com', roles: ['editor'], permissions: [],
  team_ids: [], team_names: [],
}
const viewer: Principal = {
  user_id: 3, email: 'v@x.com', roles: ['viewer'], permissions: [],
  team_ids: [], team_names: [],
}
const alice: Principal = {
  user_id: 7, email: 'alice@corp.com', roles: ['viewer'], permissions: [],
  team_ids: ['3', '7'], team_names: ['market', 'sales'],
}

let nextId = 1
function rule(partial: Partial<AclRuleRow> & { permission: string }): AclRuleRow {
  return {
    id: nextId++,
    source_id: partial.source_id ?? null,
    asset_id:  partial.asset_id  ?? null,
    field_id:  null,
    role:      partial.role ?? null,
    permission: partial.permission,
    condition: partial.condition ?? null,
    subject_type: partial.subject_type ?? null,
    subject_id:   partial.subject_id ?? null,
    effect:       partial.effect ?? 'allow',
    expires_at:   partial.expires_at ?? null,
  }
}

beforeEach(() => {
  nextId = 1
  __setRulesForTest([])
})

describe('subjectMatches · role', () => {
  it('role 匹配 → allow', async () => {
    __setRulesForTest([rule({
      source_id: 1, subject_type: 'role', subject_id: 'editor',
      permission: 'READ',
    })])
    expect((await evaluateAcl(editor, 'READ', { source_id: 1 })).allow).toBe(true)
  })

  it('role 不匹配 → deny', async () => {
    __setRulesForTest([rule({
      source_id: 1, subject_type: 'role', subject_id: 'editor',
      permission: 'READ',
    })])
    expect((await evaluateAcl(viewer, 'READ', { source_id: 1 })).allow).toBe(false)
  })

  it('role 通配 * → 任意 role 命中', async () => {
    __setRulesForTest([rule({
      source_id: 1, subject_type: 'role', subject_id: '*',
      permission: 'READ',
    })])
    expect((await evaluateAcl(viewer, 'READ', { source_id: 1 })).allow).toBe(true)
  })
})

describe('subjectMatches · user', () => {
  it('user email 精确匹配 → allow', async () => {
    __setRulesForTest([rule({
      source_id: 1, subject_type: 'user', subject_id: 'alice@corp.com',
      permission: 'READ',
    })])
    expect((await evaluateAcl(alice, 'READ', { source_id: 1 })).allow).toBe(true)
  })

  it('user email 不等 → 不命中', async () => {
    __setRulesForTest([rule({
      source_id: 1, subject_type: 'user', subject_id: 'bob@corp.com',
      permission: 'READ',
    })])
    expect((await evaluateAcl(alice, 'READ', { source_id: 1 })).allow).toBe(false)
  })
})

describe('subjectMatches · team', () => {
  it('team_id 在 principal.team_ids 中 → allow', async () => {
    __setRulesForTest([rule({
      source_id: 1, subject_type: 'team', subject_id: '3',
      permission: 'READ',
    })])
    expect((await evaluateAcl(alice, 'READ', { source_id: 1 })).allow).toBe(true)
  })

  it('team_id 不在 principal.team_ids → 不命中', async () => {
    __setRulesForTest([rule({
      source_id: 1, subject_type: 'team', subject_id: '99',
      permission: 'READ',
    })])
    expect((await evaluateAcl(alice, 'READ', { source_id: 1 })).allow).toBe(false)
  })

  it('principal 无 team_ids 字段 → 不命中 team 规则', async () => {
    __setRulesForTest([rule({
      source_id: 1, subject_type: 'team', subject_id: '3',
      permission: 'READ',
    })])
    // viewer 常量没 team_ids
    expect((await evaluateAcl(viewer, 'READ', { source_id: 1 })).allow).toBe(false)
  })
})

describe('subjectMatches · legacy（subject_type=null 回退到 role）', () => {
  it('legacy role=editor 精确匹配', async () => {
    __setRulesForTest([rule({
      source_id: 1, subject_type: null, role: 'editor',
      permission: 'READ',
    })])
    expect((await evaluateAcl(editor, 'READ', { source_id: 1 })).allow).toBe(true)
    expect((await evaluateAcl(viewer, 'READ', { source_id: 1 })).allow).toBe(false)
  })

  it('legacy role=NULL 视为全员（V1 兼容）', async () => {
    __setRulesForTest([rule({
      source_id: 1, subject_type: null, role: null,
      permission: 'READ',
    })])
    expect((await evaluateAcl(editor, 'READ', { source_id: 1 })).allow).toBe(true)
    expect((await evaluateAcl(viewer, 'READ', { source_id: 1 })).allow).toBe(true)
  })
})

describe('notExpired', () => {
  it('expires_at=NULL 恒生效', async () => {
    __setRulesForTest([rule({
      source_id: 1, subject_type: 'role', subject_id: 'viewer',
      permission: 'READ', expires_at: null,
    })])
    expect((await evaluateAcl(viewer, 'READ', { source_id: 1 })).allow).toBe(true)
  })

  it('expires_at 未来生效', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    __setRulesForTest([rule({
      source_id: 1, subject_type: 'role', subject_id: 'viewer',
      permission: 'READ', expires_at: future,
    })])
    expect((await evaluateAcl(viewer, 'READ', { source_id: 1 })).allow).toBe(true)
  })

  it('expires_at 过去 → 过滤掉', async () => {
    const past = new Date(Date.now() - 1000)
    __setRulesForTest([rule({
      source_id: 1, subject_type: 'role', subject_id: 'viewer',
      permission: 'READ', expires_at: past,
    })])
    expect((await evaluateAcl(viewer, 'READ', { source_id: 1 })).allow).toBe(false)
  })

  it('过期 deny 不计入；有效 allow 胜出', async () => {
    const past = new Date(Date.now() - 1000)
    __setRulesForTest([
      rule({ source_id: 1, subject_type: 'role', subject_id: 'viewer',
             permission: 'READ', effect: 'deny', expires_at: past }),
      rule({ source_id: 1, subject_type: 'role', subject_id: 'viewer',
             permission: 'READ', effect: 'allow' }),
    ])
    expect((await evaluateAcl(viewer, 'READ', { source_id: 1 })).allow).toBe(true)
  })
})

describe('deny 最高优', () => {
  it('单条 deny 命中即拒', async () => {
    __setRulesForTest([
      rule({ source_id: 1, subject_type: 'role', subject_id: 'editor',
             permission: 'READ', effect: 'allow' }),
      rule({ source_id: 1, subject_type: 'role', subject_id: 'editor',
             permission: 'READ', effect: 'deny' }),
    ])
    const d = await evaluateAcl(editor, 'READ', { source_id: 1 })
    expect(d.allow).toBe(false)
    expect(d.reason ?? '').toMatch(/den(y|ied)/i)
  })

  it('多条 deny 拼接 id', async () => {
    const r1 = rule({ id: 10, source_id: 1, subject_type: 'role', subject_id: 'editor',
                      permission: 'READ', effect: 'deny' })
    const r2 = rule({ id: 11, source_id: 1, subject_type: 'role', subject_id: 'editor',
                      permission: 'READ', effect: 'deny' })
    __setRulesForTest([r1, r2])
    const d = await evaluateAcl(editor, 'READ', { source_id: 1 })
    expect(d.allow).toBe(false)
    expect(d.matchedRuleIds).toEqual(expect.arrayContaining([r1.id, r2.id]))
  })

  it('无 deny + 一条 allow → allow', async () => {
    __setRulesForTest([rule({
      source_id: 1, subject_type: 'role', subject_id: 'editor',
      permission: 'READ', effect: 'allow',
    })])
    expect((await evaluateAcl(editor, 'READ', { source_id: 1 })).allow).toBe(true)
  })

  it('无任何命中 → deny-by-default', async () => {
    __setRulesForTest([rule({
      source_id: 999, subject_type: 'role', subject_id: 'editor',
      permission: 'READ',
    })])
    expect((await evaluateAcl(editor, 'READ', { source_id: 1 })).allow).toBe(false)
  })
})

describe('asset 继承 source 的 ACL', () => {
  it('父 source 的 allow 对该 source 下的 asset 生效', async () => {
    __setRulesForTest([rule({
      source_id: 7, asset_id: null, subject_type: 'role', subject_id: 'viewer',
      permission: 'READ',
    })])
    // 查询 asset#42（属于 source#7，传 source_id 表达 join 继承）
    const d = await evaluateAcl(viewer, 'READ', { source_id: 7, asset_id: 42 })
    expect(d.allow).toBe(true)
  })

  it('asset 专属规则与 source 规则同级被评估（deny 仍最高优）', async () => {
    __setRulesForTest([
      rule({ source_id: 7, asset_id: null, subject_type: 'role', subject_id: 'viewer',
             permission: 'READ', effect: 'deny' }),
      rule({ source_id: 7, asset_id: 42, subject_type: 'role', subject_id: 'viewer',
             permission: 'READ', effect: 'allow' }),
    ])
    const d = await evaluateAcl(viewer, 'READ', { source_id: 7, asset_id: 42 })
    expect(d.allow).toBe(false)
  })
})
