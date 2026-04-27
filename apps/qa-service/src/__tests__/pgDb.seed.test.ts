/**
 * R-1 双轨种子覆盖：
 *   - 新装 DB → 仅 admin READ/WRITE/ADMIN；不插入 * READ
 *   - 升级 DB（有老 * READ）→ 老行保留 + WARN 一次
 *   - 无老 * READ + 有其它规则 → 不 WARN
 *   - 幂等：重复跑不重复 INSERT / 不重复 WARN
 *
 * 对应 spec: openspec/changes/permissions-v2/specs/acl-v2-spec.md · R-1
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ensureDefaultAclRules, __resetSeedWarnForTest } from '../services/pgDb.ts'

type QueryCall = { sql: string; params: unknown[] }

/**
 * 构造一个 fake Pool：
 *   - 记录所有 query 调用
 *   - 允许调用方通过 rowsFor(sql) 动态决定 SELECT 的返回行
 */
function makeFakePool(rowsFor: (sql: string, params: unknown[]) => unknown[]) {
  const calls: QueryCall[] = []
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const p = params ?? []
      calls.push({ sql, params: p })
      const rows = rowsFor(sql, p)
      return { rows, rowCount: rows.length }
    }),
  } as unknown as import('pg').Pool
  return { pool, calls }
}

const INSERT_ADMIN = /INSERT INTO metadata_acl_rule/
const SELECT_ADMIN = /SELECT 1 FROM metadata_acl_rule[\s\S]*subject_id = 'admin'/
const SELECT_LEGACY = /SELECT id FROM metadata_acl_rule[\s\S]*subject_id = '\*'/

beforeEach(() => {
  __resetSeedWarnForTest()
  vi.restoreAllMocks()
})

describe('R-1 · 新装 DB (metadata_acl_rule 全空)', () => {
  it('只下发 admin READ/WRITE/ADMIN；不下发 * READ；不 WARN', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const { pool, calls } = makeFakePool((sql) => {
      if (SELECT_ADMIN.test(sql)) return []    // admin 行不存在 → 需要插入
      if (SELECT_LEGACY.test(sql)) return []   // 无老 * READ
      return []
    })

    await ensureDefaultAclRules(pool)

    const inserts = calls.filter((c) => INSERT_ADMIN.test(c.sql))
    expect(inserts.length).toBe(3)
    // 三次 INSERT 的 permission 是 READ/WRITE/ADMIN
    expect(inserts.map((c) => c.params[0]).sort()).toEqual(['ADMIN', 'READ', 'WRITE'])
    // 不应出现 subject_id='*' 的 INSERT（代码里硬编码 admin，这里只做 negative 断言）
    const hasStar = calls.some((c) =>
      INSERT_ADMIN.test(c.sql) &&
      JSON.stringify(c.params).includes("'*'"),
    )
    expect(hasStar).toBe(false)
    // 不 WARN
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('R-1 · 升级 DB (已有老 * READ)', () => {
  it('保留老行（不覆写） + admin 缺失则补齐 + WARN 一次', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const { pool, calls } = makeFakePool((sql) => {
      if (SELECT_ADMIN.test(sql)) return []     // admin 行缺失 → 补齐
      if (SELECT_LEGACY.test(sql)) return [{ id: 42 }]  // 发现老 * READ
      return []
    })

    await ensureDefaultAclRules(pool)

    // admin 三条 INSERT
    const inserts = calls.filter((c) => INSERT_ADMIN.test(c.sql))
    expect(inserts.length).toBe(3)
    // WARN 被调用一次
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/\[acl\]/)
    expect(warn.mock.calls[0][0]).toMatch(/rule id=42/)
    expect(warn.mock.calls[0][0]).toMatch(/iam/i)
  })
})

describe('R-1 · 升级 DB (无老 * READ 但有其它规则)', () => {
  it('仅补齐 admin（若缺）；不 WARN', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const { pool, calls } = makeFakePool((sql) => {
      if (SELECT_ADMIN.test(sql)) return []      // admin 行缺失 → 补齐
      if (SELECT_LEGACY.test(sql)) return []     // 无老 * READ
      return []
    })

    await ensureDefaultAclRules(pool)

    expect(calls.filter((c) => INSERT_ADMIN.test(c.sql)).length).toBe(3)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('R-1 · 幂等', () => {
  it('admin 三条已存在 → 0 INSERT；WARN 只在首次触发后不再重复', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const { pool, calls } = makeFakePool((sql) => {
      if (SELECT_ADMIN.test(sql)) return [{ ok: 1 }]   // admin 已存在
      if (SELECT_LEGACY.test(sql)) return [{ id: 99 }]  // 有老 * READ
      return []
    })

    // 首次调用 → WARN 一次；无 INSERT
    await ensureDefaultAclRules(pool)
    expect(calls.filter((c) => INSERT_ADMIN.test(c.sql)).length).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)

    // 二次调用 → 再次 SELECT admin、SELECT legacy，但 WARN 不再叠加（flag 已置）
    warn.mockClear()
    await ensureDefaultAclRules(pool)
    expect(calls.filter((c) => INSERT_ADMIN.test(c.sql)).length).toBe(0)
    expect(warn).not.toHaveBeenCalled()

    // 三次调用 → 同上
    await ensureDefaultAclRules(pool)
    expect(warn).not.toHaveBeenCalled()
  })
})
