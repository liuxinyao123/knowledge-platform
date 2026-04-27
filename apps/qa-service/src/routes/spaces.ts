/**
 * routes/spaces.ts —— space-permissions（ADR 2026-04-23-26）
 *
 * 契约：openspec/changes/space-permissions/specs/space-permissions-spec.md
 *
 * 端点（requireAuth；成员可 READ，admin+ 可写，owner 独占转让/删）：
 *   GET    /                              list visible spaces
 *   POST   /                              create (principal = owner)
 *   GET    /role-templates                默认 role → rule 模板
 *   GET    /:id                           detail + members preview + role_templates
 *   PATCH  /:id                           name/description/visibility
 *   DELETE /:id                           hard delete (owner + confirm:true)
 *
 *   GET    /:id/members                   list members + derived permissions
 *   POST   /:id/members                   add member
 *   PATCH  /:id/members/:key              change role
 *   DELETE /:id/members/:key              remove
 *   POST   /:id/transfer-owner            转让 owner
 *
 *   GET    /:id/sources?groupBy=tag|none  空间内 source + 分组
 *   POST   /:id/sources                   attach source
 *   DELETE /:id/sources/:sourceId         detach source
 *
 * key = `${subject_type}:${subject_id}`（URL encoded）
 */
import { Router, type Request, type Response } from 'express'
import { requireAuth } from '../auth/index.ts'
import { getPgPool } from '../services/pgDb.ts'
import {
  SPACE_ROLE_DEFAULT_RULES,
  reprojectMember,
  clearMemberProjection,
  type SpaceRole,
  type SpaceMemberSubjectType,
} from '../services/governance/spaceRoleSeed.ts'
import { reloadRules } from '../auth/evaluateAcl.ts'
import { upsertSpace, upsertSource, linkSpaceSource } from '../services/knowledgeGraph.ts'

export const spacesRouter = Router()
spacesRouter.use(requireAuth())

// ── helpers ─────────────────────────────────────────────────────────────────

function parseKey(raw: string): { type: SpaceMemberSubjectType; id: string } | null {
  const s = decodeURIComponent(raw)
  const i = s.indexOf(':')
  if (i <= 0) return null
  const t = s.slice(0, i)
  const id = s.slice(i + 1)
  if (t !== 'user' && t !== 'team') return null
  if (!id) return null
  return { type: t, id }
}

type AccessLevel = 'owner' | 'admin' | 'editor' | 'viewer'

interface SpaceAccess {
  spaceId: number
  ownerEmail: string
  myRole: AccessLevel | null  // null = 只按 visibility='org' 可见但不是成员
  isMember: boolean
}

/** 判定 principal 对 space 的可访问性 */
async function loadSpaceAccess(
  req: Request, res: Response, idStr: string,
): Promise<SpaceAccess | null> {
  const id = Number(idStr)
  if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return null }
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT id, owner_email, visibility FROM space WHERE id = $1`,
    [id],
  )
  if (rows.length === 0) { res.status(404).json({ error: 'space not found' }); return null }
  const email = req.principal?.email ?? ''
  const teamIds = req.principal?.team_ids ?? []
  const ownerEmail = String(rows[0].owner_email)
  const visibility = String(rows[0].visibility)

  // 成员身份查询
  const params: unknown[] = [id]
  const ors: string[] = []
  if (email) { params.push(email); ors.push(`(subject_type='user' AND subject_id=$${params.length})`) }
  if (teamIds.length > 0) {
    params.push(teamIds)
    ors.push(`(subject_type='team' AND subject_id = ANY($${params.length}::text[]))`)
  }
  let myRole: AccessLevel | null = null
  if (ors.length > 0) {
    const { rows: mr } = await pool.query(
      `SELECT role FROM space_member
         WHERE space_id = $1 AND (${ors.join(' OR ')})
         ORDER BY CASE role
           WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
           WHEN 'editor' THEN 2 WHEN 'viewer' THEN 3 ELSE 4 END
         LIMIT 1`,
      params,
    )
    if (mr.length > 0) myRole = mr[0].role as AccessLevel
  }

  if (myRole) {
    return { spaceId: id, ownerEmail, myRole, isMember: true }
  }
  // 非成员但空间 visibility = org → 允许 read-only 可见
  if (visibility === 'org') {
    return { spaceId: id, ownerEmail, myRole: null, isMember: false }
  }
  res.status(403).json({ error: 'not accessible' })
  return null
}

function needAdmin(access: SpaceAccess, res: Response): boolean {
  if (access.myRole === 'owner' || access.myRole === 'admin') return true
  res.status(403).json({ error: 'admin or owner required' })
  return false
}

function needOwner(access: SpaceAccess, res: Response): boolean {
  if (access.myRole === 'owner') return true
  res.status(403).json({ error: 'owner required' })
  return false
}

async function audit(
  op: 'create' | 'update' | 'delete' | 'transfer',
  req: Request,
  beforeJson: unknown,
  afterJson: unknown,
  ruleId?: number | null,
): Promise<void> {
  const pool = getPgPool()
  try {
    await pool.query(
      `INSERT INTO acl_rule_audit (rule_id, actor_user_id, actor_email, op, before_json, after_json)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        ruleId ?? null,
        req.principal?.user_id ?? null,
        req.principal?.email ?? null,
        op,
        beforeJson == null ? null : JSON.stringify(beforeJson),
        afterJson == null ? null : JSON.stringify(afterJson),
      ],
    )
  } catch {
    // 审计写失败不阻塞业务
  }
}

// ── space CRUD ──────────────────────────────────────────────────────────────

spacesRouter.get('/', async (req: Request, res: Response) => {
  const email = req.principal?.email
  if (!email) return res.status(401).json({ error: 'unauthenticated' })
  const teamIds = req.principal?.team_ids ?? []
  const pool = getPgPool()
  // 可见性：visibility=org 全员可见 / visibility=private 仅成员
  const params: unknown[] = [email, teamIds]
  const { rows } = await pool.query(
    `WITH my_member AS (
       SELECT sm.space_id, sm.role
         FROM space_member sm
        WHERE (sm.subject_type='user' AND sm.subject_id=$1)
           OR (sm.subject_type='team' AND sm.subject_id = ANY($2::text[]))
     )
     SELECT s.id, s.slug, s.name, s.description, s.visibility, s.owner_email,
            EXTRACT(EPOCH FROM s.updated_at) * 1000 AS updated_at_ms,
            (SELECT role FROM my_member WHERE space_id=s.id LIMIT 1) AS my_role,
            (SELECT COUNT(*)::int FROM space_source WHERE space_id=s.id) AS source_count,
            (SELECT COUNT(DISTINCT a.id)::int
               FROM space_source ss
               JOIN metadata_asset a ON a.source_id = ss.source_id
              WHERE ss.space_id = s.id) AS doc_count,
            (SELECT COUNT(*)::int FROM space_member WHERE space_id=s.id) AS member_count
       FROM space s
      WHERE s.visibility = 'org'
         OR s.id IN (SELECT space_id FROM my_member)
      ORDER BY s.updated_at DESC, s.id DESC`,
    params,
  )
  res.json({
    items: rows.map((r) => ({
      id: Number(r.id),
      slug: String(r.slug),
      name: String(r.name),
      description: r.description ?? null,
      visibility: String(r.visibility),
      owner_email: String(r.owner_email),
      doc_count: Number(r.doc_count),
      source_count: Number(r.source_count),
      member_count: Number(r.member_count),
      my_role: r.my_role ?? null,
      updated_at_ms: Number(r.updated_at_ms),
    })),
  })
})

spacesRouter.post('/', async (req: Request, res: Response) => {
  const email = req.principal?.email
  if (!email) return res.status(401).json({ error: 'unauthenticated' })
  const { slug, name, description, visibility, initialMembers } = req.body ?? {}
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return res.status(400).json({ error: 'invalid slug' })
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' })
  }
  const vis = visibility === 'private' ? 'private' : 'org'
  const pool = getPgPool()
  const tx = await pool.connect()
  try {
    await tx.query('BEGIN')
    const { rows: ex } = await tx.query(`SELECT id FROM space WHERE slug=$1`, [slug])
    if (ex.length > 0) { await tx.query('ROLLBACK'); return res.status(409).json({ error: 'slug already exists' }) }
    const { rows: sr } = await tx.query(
      `INSERT INTO space (slug, name, description, visibility, owner_email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [slug, name.trim(), description ?? null, vis, email],
    )
    const spaceId = Number(sr[0].id)
    // owner member
    await tx.query(
      `INSERT INTO space_member (space_id, subject_type, subject_id, role, added_by)
       VALUES ($1, 'user', $2, 'owner', $2)`,
      [spaceId, email],
    )
    await reprojectMember(tx, spaceId, 'user', email, 'owner')
    // 初始成员
    const initial: Array<{ subject_type: SpaceMemberSubjectType; subject_id: string; role: SpaceRole }>
      = Array.isArray(initialMembers) ? initialMembers : []
    for (const m of initial) {
      if (!m || (m.subject_type !== 'user' && m.subject_type !== 'team')) continue
      if (!m.subject_id) continue
      if (!['admin','editor','viewer'].includes(m.role)) continue
      if (m.subject_type === 'user' && m.subject_id === email) continue  // 已是 owner
      await tx.query(
        `INSERT INTO space_member (space_id, subject_type, subject_id, role, added_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (space_id, subject_type, subject_id) DO NOTHING`,
        [spaceId, m.subject_type, m.subject_id, m.role, email],
      )
      await reprojectMember(tx, spaceId, m.subject_type, m.subject_id, m.role)
    }
    await tx.query('COMMIT')
    await reloadRules()
    await audit('create', req, null, { space_id: spaceId, slug, name, visibility: vis })
    // KG 写入（fire-and-forget）
    void upsertSpace({ id: spaceId, name })
    res.status(201).json({ id: spaceId })
  } catch (e) {
    await tx.query('ROLLBACK').catch(() => {})
    res.status(500).json({ error: (e as Error).message })
  } finally {
    tx.release()
  }
})

spacesRouter.get('/role-templates', (_req: Request, res: Response) => {
  res.json({ templates: SPACE_ROLE_DEFAULT_RULES })
})

spacesRouter.get('/:id', async (req: Request, res: Response) => {
  const access = await loadSpaceAccess(req, res, String(req.params.id))
  if (!access) return
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT s.*,
            (SELECT COUNT(DISTINCT a.id)::int
               FROM space_source ss
               JOIN metadata_asset a ON a.source_id = ss.source_id
              WHERE ss.space_id = s.id) AS doc_count,
            (SELECT COUNT(*)::int FROM space_source WHERE space_id=s.id) AS source_count,
            (SELECT COUNT(*)::int FROM space_member WHERE space_id=s.id) AS member_count
       FROM space s WHERE s.id = $1`,
    [access.spaceId],
  )
  const row = rows[0]
  // members preview (前 5 条按角色序)
  const { rows: mrows } = await pool.query(
    `SELECT subject_type, subject_id, role, added_at
       FROM space_member
       WHERE space_id = $1
       ORDER BY CASE role
         WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
         WHEN 'editor' THEN 2 WHEN 'viewer' THEN 3 ELSE 4 END,
         added_at ASC
       LIMIT 5`,
    [access.spaceId],
  )
  res.json({
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: row.description ?? null,
    visibility: String(row.visibility),
    owner_email: String(row.owner_email),
    doc_count: Number(row.doc_count),
    source_count: Number(row.source_count),
    member_count: Number(row.member_count),
    my_role: access.myRole,
    is_member: access.isMember,
    created_at: row.created_at,
    updated_at: row.updated_at,
    members_preview: mrows.map((r) => ({
      subject_type: String(r.subject_type),
      subject_id: String(r.subject_id),
      role: String(r.role),
      added_at: r.added_at,
    })),
    role_templates: SPACE_ROLE_DEFAULT_RULES,
  })
})

spacesRouter.patch('/:id', async (req: Request, res: Response) => {
  const access = await loadSpaceAccess(req, res, String(req.params.id))
  if (!access) return
  if (!needAdmin(access, res)) return
  const { name, description, visibility } = req.body ?? {}
  const patches: string[] = []
  const params: unknown[] = []
  if (typeof name === 'string' && name.trim()) {
    params.push(name.trim()); patches.push(`name=$${params.length}`)
  }
  if (description === null || typeof description === 'string') {
    params.push(description); patches.push(`description=$${params.length}`)
  }
  if (visibility === 'org' || visibility === 'private') {
    params.push(visibility); patches.push(`visibility=$${params.length}`)
  }
  if (patches.length === 0) return res.status(400).json({ error: 'no changes' })
  params.push(access.spaceId)
  const pool = getPgPool()
  await pool.query(
    `UPDATE space SET ${patches.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
    params,
  )
  await audit('update', req, null, { space_id: access.spaceId, ...req.body })
  res.json({ ok: true })
})

spacesRouter.delete('/:id', async (req: Request, res: Response) => {
  const access = await loadSpaceAccess(req, res, String(req.params.id))
  if (!access) return
  if (!needOwner(access, res)) return
  if (req.body?.confirm !== true) {
    return res.status(412).json({ error: 'confirm:true required' })
  }
  const pool = getPgPool()
  await pool.query(`DELETE FROM space WHERE id = $1`, [access.spaceId])
  await reloadRules()
  await audit('delete', req, { space_id: access.spaceId }, null)
  res.json({ ok: true })
})

// ── members ─────────────────────────────────────────────────────────────────

spacesRouter.get('/:id/members', async (req: Request, res: Response) => {
  const access = await loadSpaceAccess(req, res, String(req.params.id))
  if (!access) return
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT sm.subject_type, sm.subject_id, sm.role, sm.added_by, sm.added_at,
            CASE WHEN sm.subject_type='team'
                 THEN (SELECT name FROM team WHERE id::text = sm.subject_id)
                 ELSE NULL END AS team_name
       FROM space_member sm
       WHERE sm.space_id = $1
       ORDER BY CASE sm.role
         WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
         WHEN 'editor' THEN 2 WHEN 'viewer' THEN 3 ELSE 4 END,
         sm.added_at ASC`,
    [access.spaceId],
  )
  res.json({
    items: rows.map((r) => {
      const role = String(r.role) as SpaceRole
      const tmpl = SPACE_ROLE_DEFAULT_RULES[role] ?? []
      const derived = Array.from(new Set(tmpl.map((t) => t.permission)))
      return {
        subject_type: String(r.subject_type),
        subject_id: String(r.subject_id),
        role,
        display_name: r.subject_type === 'team' ? (r.team_name ?? `团队 #${r.subject_id}`) : String(r.subject_id),
        added_by: r.added_by ?? null,
        added_at: r.added_at,
        derived_permissions: derived,
      }
    }),
  })
})

spacesRouter.post('/:id/members', async (req: Request, res: Response) => {
  const access = await loadSpaceAccess(req, res, String(req.params.id))
  if (!access) return
  if (!needAdmin(access, res)) return
  const { subject_type, subject_id, role } = req.body ?? {}
  if (subject_type !== 'user' && subject_type !== 'team') {
    return res.status(400).json({ error: 'invalid subject_type' })
  }
  if (typeof subject_id !== 'string' || !subject_id) {
    return res.status(400).json({ error: 'subject_id required' })
  }
  if (!['admin','editor','viewer'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin/editor/viewer' })
  }
  if (subject_type === 'user' && !/^[^@\s]+@[^@\s]+$/.test(subject_id)) {
    return res.status(400).json({ error: 'user subject_id must be email' })
  }
  if (subject_type === 'team' && !/^\d+$/.test(subject_id)) {
    return res.status(400).json({ error: 'team subject_id must be numeric id' })
  }
  const pool = getPgPool()
  const tx = await pool.connect()
  try {
    await tx.query('BEGIN')
    const { rows: ex } = await tx.query(
      `SELECT 1 FROM space_member
        WHERE space_id=$1 AND subject_type=$2 AND subject_id=$3`,
      [access.spaceId, subject_type, subject_id],
    )
    if (ex.length > 0) { await tx.query('ROLLBACK'); return res.status(409).json({ error: 'member already exists' }) }
    await tx.query(
      `INSERT INTO space_member (space_id, subject_type, subject_id, role, added_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [access.spaceId, subject_type, subject_id, role, req.principal?.email ?? null],
    )
    await reprojectMember(tx, access.spaceId, subject_type, subject_id, role as SpaceRole)
    await tx.query('COMMIT')
    await reloadRules()
    await audit('create', req, null, { space_id: access.spaceId, subject_type, subject_id, role })
    res.status(201).json({ ok: true })
  } catch (e) {
    await tx.query('ROLLBACK').catch(() => {})
    res.status(500).json({ error: (e as Error).message })
  } finally {
    tx.release()
  }
})

spacesRouter.patch('/:id/members/:key', async (req: Request, res: Response) => {
  const access = await loadSpaceAccess(req, res, String(req.params.id))
  if (!access) return
  if (!needAdmin(access, res)) return
  const k = parseKey(String(req.params.key))
  if (!k) return res.status(400).json({ error: 'invalid key' })
  const { role } = req.body ?? {}
  if (!['admin','editor','viewer'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin/editor/viewer; use transfer-owner for owner' })
  }
  const pool = getPgPool()
  const tx = await pool.connect()
  try {
    await tx.query('BEGIN')
    const { rows } = await tx.query(
      `SELECT role FROM space_member
        WHERE space_id=$1 AND subject_type=$2 AND subject_id=$3 FOR UPDATE`,
      [access.spaceId, k.type, k.id],
    )
    if (rows.length === 0) { await tx.query('ROLLBACK'); return res.status(404).json({ error: 'member not found' }) }
    if (rows[0].role === 'owner') { await tx.query('ROLLBACK'); return res.status(400).json({ error: 'owner role not editable; use transfer-owner' }) }
    await tx.query(
      `UPDATE space_member SET role=$1
        WHERE space_id=$2 AND subject_type=$3 AND subject_id=$4`,
      [role, access.spaceId, k.type, k.id],
    )
    await reprojectMember(tx, access.spaceId, k.type, k.id, role as SpaceRole)
    await tx.query('COMMIT')
    await reloadRules()
    await audit('update', req, { role: rows[0].role }, { role })
    res.json({ ok: true })
  } catch (e) {
    await tx.query('ROLLBACK').catch(() => {})
    res.status(500).json({ error: (e as Error).message })
  } finally {
    tx.release()
  }
})

spacesRouter.delete('/:id/members/:key', async (req: Request, res: Response) => {
  const access = await loadSpaceAccess(req, res, String(req.params.id))
  if (!access) return
  if (!needAdmin(access, res)) return
  const k = parseKey(String(req.params.key))
  if (!k) return res.status(400).json({ error: 'invalid key' })
  const pool = getPgPool()
  const tx = await pool.connect()
  try {
    await tx.query('BEGIN')
    const { rows } = await tx.query(
      `SELECT role FROM space_member
        WHERE space_id=$1 AND subject_type=$2 AND subject_id=$3 FOR UPDATE`,
      [access.spaceId, k.type, k.id],
    )
    if (rows.length === 0) { await tx.query('ROLLBACK'); return res.status(404).json({ error: 'member not found' }) }
    if (rows[0].role === 'owner') { await tx.query('ROLLBACK'); return res.status(400).json({ error: 'owner cannot be removed; transfer first' }) }
    await clearMemberProjection(tx, access.spaceId, k.type, k.id)
    await tx.query(
      `DELETE FROM space_member WHERE space_id=$1 AND subject_type=$2 AND subject_id=$3`,
      [access.spaceId, k.type, k.id],
    )
    await tx.query('COMMIT')
    await reloadRules()
    await audit('delete', req, { space_id: access.spaceId, ...k, role: rows[0].role }, null)
    res.json({ ok: true })
  } catch (e) {
    await tx.query('ROLLBACK').catch(() => {})
    res.status(500).json({ error: (e as Error).message })
  } finally {
    tx.release()
  }
})

spacesRouter.post('/:id/transfer-owner', async (req: Request, res: Response) => {
  const access = await loadSpaceAccess(req, res, String(req.params.id))
  if (!access) return
  if (!needOwner(access, res)) return
  const { subject_type, subject_id } = req.body ?? {}
  if (subject_type !== 'user' || typeof subject_id !== 'string' || !subject_id) {
    return res.status(400).json({ error: 'subject_type must be user; subject_id required' })
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(subject_id)) {
    return res.status(400).json({ error: 'subject_id must be email' })
  }
  const pool = getPgPool()
  const tx = await pool.connect()
  try {
    await tx.query('BEGIN')
    // 目标：若不存在 member → 插成 admin 再升 owner；若存在 → 升 owner
    const { rows: tgt } = await tx.query(
      `SELECT role FROM space_member
        WHERE space_id=$1 AND subject_type='user' AND subject_id=$2 FOR UPDATE`,
      [access.spaceId, subject_id],
    )
    if (tgt.length === 0) {
      await tx.query(
        `INSERT INTO space_member (space_id, subject_type, subject_id, role, added_by)
         VALUES ($1, 'user', $2, 'owner', $3)`,
        [access.spaceId, subject_id, req.principal?.email ?? null],
      )
    } else {
      await tx.query(
        `UPDATE space_member SET role='owner'
          WHERE space_id=$1 AND subject_type='user' AND subject_id=$2`,
        [access.spaceId, subject_id],
      )
    }
    // 原 owner 降 admin
    await tx.query(
      `UPDATE space_member SET role='admin'
        WHERE space_id=$1 AND subject_type='user' AND subject_id=$2`,
      [access.spaceId, access.ownerEmail],
    )
    await tx.query(
      `UPDATE space SET owner_email=$1, updated_at=NOW() WHERE id=$2`,
      [subject_id, access.spaceId],
    )
    // 重投影两边
    await reprojectMember(tx, access.spaceId, 'user', subject_id, 'owner')
    await reprojectMember(tx, access.spaceId, 'user', access.ownerEmail, 'admin')
    await tx.query('COMMIT')
    await reloadRules()
    await audit('transfer', req,
      { from: access.ownerEmail },
      { to: subject_id, space_id: access.spaceId },
    )
    res.json({ ok: true })
  } catch (e) {
    await tx.query('ROLLBACK').catch(() => {})
    res.status(500).json({ error: (e as Error).message })
  } finally {
    tx.release()
  }
})

// ── sources under space ─────────────────────────────────────────────────────

function groupSources(
  rows: Array<{ id: number; name: string; tag: string | null; asset_count: number; updated_at_ms: number }>,
  groupBy: 'tag' | 'none',
): Array<{ name: string; sources: typeof rows }> {
  if (groupBy === 'none') return [{ name: '全部', sources: rows }]
  const buckets = new Map<string, typeof rows>()
  for (const r of rows) {
    const key = r.tag && r.tag.trim() ? r.tag.trim() : '未归类'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(r)
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => {
      if (a === '未归类') return 1
      if (b === '未归类') return -1
      return a.localeCompare(b, 'zh-Hans-CN')
    })
    .map(([name, sources]) => ({ name, sources }))
}

spacesRouter.get('/:id/sources', async (req: Request, res: Response) => {
  const access = await loadSpaceAccess(req, res, String(req.params.id))
  if (!access) return
  const groupBy = req.query.groupBy === 'tag' ? 'tag' : (req.query.groupBy === 'none' ? 'none' : 'tag')
  const pool = getPgPool()
  const { rows } = await pool.query(
    `SELECT s.id, s.name,
            COALESCE(s.config->>'group_tag', NULL) AS tag,
            (SELECT COUNT(*)::int FROM metadata_asset a WHERE a.source_id = s.id) AS asset_count,
            EXTRACT(EPOCH FROM s.created_at) * 1000 AS updated_at_ms
       FROM space_source ss
       JOIN metadata_source s ON s.id = ss.source_id
       WHERE ss.space_id = $1
       ORDER BY s.name`,
    [access.spaceId],
  )
  const items = rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    tag: r.tag ?? null,
    asset_count: Number(r.asset_count),
    updated_at_ms: Number(r.updated_at_ms),
  }))
  res.json({ groups: groupSources(items, groupBy) })
})

spacesRouter.post('/:id/sources', async (req: Request, res: Response) => {
  const access = await loadSpaceAccess(req, res, String(req.params.id))
  if (!access) return
  if (!needAdmin(access, res)) return
  const sourceIds: number[] = Array.isArray(req.body?.source_ids)
    ? req.body.source_ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
    : []
  if (sourceIds.length === 0) return res.status(400).json({ error: 'source_ids required' })
  const pool = getPgPool()
  let added = 0
  for (const sid of sourceIds) {
    const r = await pool.query(
      `INSERT INTO space_source (space_id, source_id) VALUES ($1, $2)
       ON CONFLICT (space_id, source_id) DO NOTHING`,
      [access.spaceId, sid],
    )
    added += r.rowCount ?? 0
  }
  await audit('update', req, null, { space_id: access.spaceId, attached_sources: sourceIds })
  // KG 写入（fire-and-forget）
  void (async () => {
    for (const sid of sourceIds) {
      try {
        await upsertSource({ id: sid, name: `source#${sid}` })
        await linkSpaceSource(access.spaceId, sid)
      } catch { /* noop */ }
    }
  })()
  res.json({ added })
})

spacesRouter.delete('/:id/sources/:sourceId', async (req: Request, res: Response) => {
  const access = await loadSpaceAccess(req, res, String(req.params.id))
  if (!access) return
  if (!needAdmin(access, res)) return
  const sid = Number(String(req.params.sourceId))
  if (!Number.isFinite(sid)) return res.status(400).json({ error: 'invalid sourceId' })
  const pool = getPgPool()
  await pool.query(
    `DELETE FROM space_source WHERE space_id=$1 AND source_id=$2`,
    [access.spaceId, sid],
  )
  await audit('update', req, { space_id: access.spaceId, detached: sid }, null)
  res.json({ ok: true })
})
