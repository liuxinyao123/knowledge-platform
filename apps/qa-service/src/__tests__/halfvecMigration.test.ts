/**
 * asset-vector-coloc · halfvec 迁移逻辑单测
 *
 * 不依赖真实 PG，纯 mock 验证 migrateToHalfvec 的分派：
 *   1. PGVECTOR_HALF_PRECISION=false → 不发任何 ALTER/INDEX SQL
 *   2. pgvector < 0.7 → 不发 ALTER/INDEX SQL
 *   3. 列已是 halfvec → 不发 ALTER，但仍重建索引（幂等）
 *   4. 列是 vector → 发 ALTER + DROP INDEX + CREATE INDEX (halfvec_cosine_ops)
 *
 * cosine 误差 < 0.001 的端到端验证留给集成测（用户机器跑 docker-compose）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { migrateToHalfvec } from '../services/pgDb.ts'

interface CapturedQuery {
  sql: string
  params?: unknown[]
}

/** 简单 pg.Pool mock：按 SQL 关键字分发返回结果，并记录所有 query */
function makePool(opts: {
  pgVersion: string
  columns: Array<{ table_name: string; column_name: string; type_text: string }>
}): { pool: any; captured: CapturedQuery[] } {
  const captured: CapturedQuery[] = []
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      captured.push({ sql, params })
      const s = sql.replace(/\s+/g, ' ').trim().toLowerCase()
      if (s.includes("from pg_extension where extname='vector'")) {
        return { rows: [{ extversion: opts.pgVersion }] }
      }
      if (s.includes('from pg_attribute')) {
        return { rows: opts.columns }
      }
      // ALTER TABLE / DROP INDEX / CREATE INDEX 一律 OK
      return { rows: [] }
    }),
  }
  return { pool, captured }
}

const ORIGINAL_FLAG = process.env.PGVECTOR_HALF_PRECISION

describe('migrateToHalfvec — 分派', () => {
  beforeEach(() => {
    delete process.env.PGVECTOR_HALF_PRECISION
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.PGVECTOR_HALF_PRECISION
    else process.env.PGVECTOR_HALF_PRECISION = ORIGINAL_FLAG
    vi.restoreAllMocks()
  })

  // ADR-44 锁定：halfvec 在 GM-LIFTGATE32 上实测推 5 题跌出 top-5，
  // 默认 OFF。下面默认场景断言"不应该跑迁移"。
  it('默认未设 env → 不发任何 SQL（ADR-44 安全默认）', async () => {
    const { pool, captured } = makePool({ pgVersion: '0.8.2', columns: [] })
    await migrateToHalfvec(pool)
    expect(captured).toHaveLength(0)
  })

  it.each(['false', '0', 'off', 'no', ''])('PGVECTOR_HALF_PRECISION=%s 跳过', async (v) => {
    process.env.PGVECTOR_HALF_PRECISION = v
    const { pool, captured } = makePool({ pgVersion: '0.8.2', columns: [] })
    await migrateToHalfvec(pool)
    expect(captured).toHaveLength(0)
  })

  it('pgvector 0.6.x + 显式 on → 跳过（halfvec 不可用）', async () => {
    process.env.PGVECTOR_HALF_PRECISION = 'true'
    const { pool, captured } = makePool({ pgVersion: '0.6.0', columns: [] })
    await migrateToHalfvec(pool)
    expect(captured.some((c) => c.sql.toLowerCase().includes('alter table'))).toBe(false)
    expect(captured.some((c) => c.sql.toLowerCase().includes('drop index'))).toBe(false)
    expect(captured.some((c) => c.sql.toLowerCase().includes('create index'))).toBe(false)
  })

  it('显式 on + 列已是 halfvec → 不发 ALTER，但仍重建索引', async () => {
    process.env.PGVECTOR_HALF_PRECISION = 'true'
    const { pool, captured } = makePool({
      pgVersion: '0.8.2',
      columns: [
        { table_name: 'metadata_field', column_name: 'embedding', type_text: 'halfvec(4096)' },
        { table_name: 'chunk_abstract', column_name: 'l0_embedding', type_text: 'halfvec(4096)' },
      ],
    })
    await migrateToHalfvec(pool)
    expect(captured.some((c) => c.sql.toLowerCase().includes('alter table'))).toBe(false)
    expect(captured.some((c) => c.sql.toLowerCase().includes('drop index if exists idx_field_embedding'))).toBe(true)
    expect(captured.some((c) => c.sql.toLowerCase().includes('create index if not exists idx_field_embedding'))).toBe(true)
  })

  it('显式 on + 列是 vector(4096) → 发 ALTER + 重建索引（halfvec_cosine_ops）', async () => {
    process.env.PGVECTOR_HALF_PRECISION = 'true'
    const { pool, captured } = makePool({
      pgVersion: '0.8.2',
      columns: [
        { table_name: 'metadata_field', column_name: 'embedding', type_text: 'vector(4096)' },
        { table_name: 'chunk_abstract', column_name: 'l0_embedding', type_text: 'vector(4096)' },
      ],
    })
    await migrateToHalfvec(pool)
    const lowered = captured.map((c) => c.sql.toLowerCase().replace(/\s+/g, ' '))
    const alters = lowered.filter((s) => s.includes('alter table'))
    expect(alters).toHaveLength(2)
    expect(alters[0]).toContain('halfvec(4096)')
    expect(alters[1]).toContain('halfvec(4096)')
    const creates = lowered.filter((s) => s.includes('create index'))
    expect(creates.some((s) => s.includes('halfvec_cosine_ops'))).toBe(true)
    expect(creates.some((s) => s.includes('vector_cosine_ops'))).toBe(false)
  })

  it('显式 on + 混合（一列 halfvec / 一列 vector）→ 只迁后者', async () => {
    process.env.PGVECTOR_HALF_PRECISION = 'true'
    const { pool, captured } = makePool({
      pgVersion: '0.8.2',
      columns: [
        { table_name: 'metadata_field', column_name: 'embedding', type_text: 'halfvec(4096)' },
        { table_name: 'chunk_abstract', column_name: 'l0_embedding', type_text: 'vector(4096)' },
      ],
    })
    await migrateToHalfvec(pool)
    const alters = captured
      .map((c) => c.sql.toLowerCase().replace(/\s+/g, ' '))
      .filter((s) => s.includes('alter table'))
    expect(alters).toHaveLength(1)
    expect(alters[0]).toContain('chunk_abstract')
  })

  it('显式 on + 未知列类型 → 跳过 + warn，不报错', async () => {
    process.env.PGVECTOR_HALF_PRECISION = 'true'
    const { pool, captured } = makePool({
      pgVersion: '0.8.2',
      columns: [
        { table_name: 'metadata_field', column_name: 'embedding', type_text: 'text' },
      ],
    })
    await expect(migrateToHalfvec(pool)).resolves.toBeUndefined()
    expect(captured.some((c) => c.sql.toLowerCase().includes('alter table'))).toBe(false)
  })
})
