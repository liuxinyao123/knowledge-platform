/**
 * space-permissions 评估覆盖：
 *   1. space-scoped allow：rule.space_id=X，resource 在空间 X 内 → allow
 *   2. space-scoped allow：rule.space_id=X，resource 在空间 Y 内 → deny
 *   3. space-scoped deny 压过 org 级 allow
 *   4. 双空间归属：任一命中即可（allow 合并）；其中任一 deny 直接 wins
 *   5. 空 space_ids（资源无空间归属）→ space-scoped 规则一律跳过，等价老行为
 *
 * 对应 spec: openspec/changes/space-permissions/specs/space-permissions-spec.md
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { __setRulesForTest, evaluateAcl } from '../auth/evaluateAcl.ts'
import type { AclRuleRow, Principal, AclResource } from '../auth/types.ts'

const editor: Principal = {
  user_id: 1, email: 'e@x.com', roles: ['editor'], permissions: [],
  team_ids: [], team_names: [],
}

let nextId = 1
function rule(partial: Partial<AclRuleRow> & { permission: string }): AclRuleRow {
  return {
    id: nextId++,
    source_id: partial.source_id ?? null,
    asset_id:  partial.asset_id  ?? null,
    space_id:  partial.space_id  ?? null,
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

/** resource 直接传 space_ids 绕过 resolveSpace 的 DB 查询 */
function res(partial: AclResource & { space_ids: number[] }): AclResource {
  return partial
}

beforeEach(() => {
  nextId = 1
  __setRulesForTest([])
})

describe('space-scoped allow', () => {
  it('rule.space_id=1 且 resource.space_ids=[1] → allow', async () => {
    __setRulesForTest([rule({
      space_id: 1, subject_type: 'role', subject_id: 'editor', permission: 'READ',
    })])
    const d = await evaluateAcl(editor, 'READ', res({ space_ids: [1] }))
    expect(d.allow).toBe(true)
  })

  it('rule.space_id=1 但 resource.space_ids=[2] → deny', async () => {
    __setRulesForTest([rule({
      space_id: 1, subject_type: 'role', subject_id: 'editor', permission: 'READ',
    })])
    const d = await evaluateAcl(editor, 'READ', res({ space_ids: [2] }))
    expect(d.allow).toBe(false)
  })
})

describe('deny > allow (space scope)', () => {
  it('space-scoped deny 压过 org 级 allow', async () => {
    __setRulesForTest([
      rule({ space_id: null, subject_type: 'role', subject_id: 'editor', permission: 'READ' }),
      rule({ space_id: 1, subject_type: 'role', subject_id: 'editor', permission: 'READ', effect: 'deny' }),
    ])
    const d = await evaluateAcl(editor, 'READ', res({ space_ids: [1] }))
    expect(d.allow).toBe(false)
    expect(d.reason).toMatch(/denied/i)
  })
})

describe('multi-space membership', () => {
  it('资源属两个空间，任一 allow 命中 → allow', async () => {
    __setRulesForTest([
      rule({ space_id: 2, subject_type: 'role', subject_id: 'editor', permission: 'READ' }),
    ])
    const d = await evaluateAcl(editor, 'READ', res({ space_ids: [1, 2] }))
    expect(d.allow).toBe(true)
  })

  it('任一空间里有 deny → deny（deny 永远 wins）', async () => {
    __setRulesForTest([
      rule({ space_id: 1, subject_type: 'role', subject_id: 'editor', permission: 'READ' }),
      rule({ space_id: 2, subject_type: 'role', subject_id: 'editor', permission: 'READ', effect: 'deny' }),
    ])
    const d = await evaluateAcl(editor, 'READ', res({ space_ids: [1, 2] }))
    expect(d.allow).toBe(false)
  })
})

describe('backward compat', () => {
  it('resource 无空间归属（space_ids=[]）→ 只 org 级 rule 参评', async () => {
    __setRulesForTest([
      rule({ space_id: null, subject_type: 'role', subject_id: 'editor', permission: 'READ' }),
      rule({ space_id: 1,    subject_type: 'role', subject_id: 'editor', permission: 'WRITE' }),
    ])
    const d = await evaluateAcl(editor, 'READ', res({ space_ids: [] }))
    expect(d.allow).toBe(true)   // 命中 org 级
  })

  it('resource 无空间归属 + 只有 space-scoped 规则 → deny', async () => {
    __setRulesForTest([
      rule({ space_id: 1, subject_type: 'role', subject_id: 'editor', permission: 'READ' }),
    ])
    const d = await evaluateAcl(editor, 'READ', res({ space_ids: [] }))
    expect(d.allow).toBe(false)
  })
})
