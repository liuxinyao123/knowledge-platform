/**
 * RulesTab —— 规则列表 + 新建/编辑 Modal + Simulate 面板
 *
 * Permissions V2：
 *   - subject_type ∈ {role, user, team} + subject_id（可填 *）
 *   - effect ∈ {allow, deny}
 *   - expires_at 可选 TTL
 *   - role 字段保留，仅向下兼容；新规则统一用 subject_*
 */
import { useEffect, useState, useCallback } from 'react'
import {
  type AclRule, type RulePatch, type SimulateResult, type SimulatePrincipal,
  type RoleMatrix, type SubjectType, type RuleEffect,
  listRules, createRule, updateRule, deleteRule, simulateRule, listPermissions,
  getRoleMatrix,
} from '@/api/iam'
import { listTeams, type TeamSummary } from '@/api/teams'

// ── 中文描述辅助 ─────────────────────────────────────────────
const ACTION_LABEL: Record<string, string> = {
  READ:   '查看 (READ)',
  WRITE:  '修改 (WRITE)',
  DELETE: '删除 (DELETE)',
  ADMIN:  '管理 (ADMIN = 全权)',
}

function conditionSummary(c: Record<string, unknown> | null): string {
  if (!c) return '—'
  const parts: string[] = []
  const cond = c as {
    mask?: Array<{ field: string; mode: string }>
    project_id?: string
    where?: string
  }
  if (cond.mask && cond.mask.length) {
    parts.push(`脱敏 ${cond.mask.length} 字段`)
  }
  if (cond.project_id) parts.push(`限项目 ${cond.project_id}`)
  if (cond.where) parts.push(`行级条件`)
  return parts.length ? parts.join(' · ') : '—'
}

function describeSubject(r: AclRule, teams: TeamSummary[]): string {
  // 优先 V2 字段
  const st = r.subject_type as SubjectType | null | undefined
  const sid = r.subject_id ?? null
  if (st && sid) {
    if (sid === '*') return st === 'role' ? '所有角色' : st === 'user' ? '所有用户' : '所有团队'
    if (st === 'role') return `角色「${sid}」`
    if (st === 'user') return `用户「${sid}」`
    if (st === 'team') {
      const tid = Number(sid)
      const t = teams.find((x) => x.id === tid)
      return t ? `团队「${t.name}」` : `团队 #${sid}`
    }
  }
  // V1 兼容
  return r.role ? `角色「${r.role}」的用户` : `所有角色`
}

function describeRule(r: AclRule, teams: TeamSummary[]): string {
  const who = describeSubject(r, teams)
  const act =
    r.permission === 'READ'   ? '查看' :
    r.permission === 'WRITE'  ? '修改' :
    r.permission === 'DELETE' ? '删除' :
    r.permission === 'ADMIN'  ? '全权管理' :
    `权限「${r.permission}」`
  const verb = r.effect === 'deny' ? '禁止' : '可以'
  const resParts: string[] = []
  if (r.source_id != null) resParts.push(`数据源 #${r.source_id}`)
  if (r.asset_id != null)  resParts.push(`资产 #${r.asset_id}`)
  const res = resParts.length ? resParts.join(' · ') : '所有资源'

  const extras: string[] = []
  const c = r.condition as
    | { mask?: Array<{ field: string; mode: string }>; project_id?: string; where?: string }
    | null
  if (c?.mask && c.mask.length) {
    extras.push(`脱敏 ${c.mask.map((m) => `${m.field}(${m.mode})`).join(', ')}`)
  }
  if (c?.project_id) extras.push(`限项目 ${c.project_id}`)
  if (c?.where) extras.push(`行级条件 ${c.where}`)
  if (r.expires_at) extras.push(`过期 ${new Date(r.expires_at).toLocaleString()}`)

  const suffix = extras.length ? ` · ${extras.join(' · ')}` : ''
  return `${who} ${verb} ${act} ${res}${suffix}`
}

type ModalMode = null | { type: 'create' } | { type: 'edit'; rule: AclRule }

export default function RulesTab() {
  const [rules, setRules] = useState<AclRule[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [permOptions, setPermOptions] = useState<string[]>([])
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [modal, setModal] = useState<ModalMode>(null)
  const [simulateFor, setSimulateFor] = useState<AclRule | null>(null)

  const load = useCallback(() => {
    listRules()
      .then((r) => { setRules(r); setErr(null) })
      .catch((e) => {
        setErr(e?.response?.data?.error || e?.message || '加载失败')
        // BUG-05 防御：失败时也退出 "加载中…" 态（否则 UI 会同时显示 error + "加载中…"）
        setRules([])
      })
  }, [])

  useEffect(() => {
    load()
    listPermissions().then(setPermOptions).catch(() => {})
    listTeams().then(setTeams).catch(() => setTeams([]))
  }, [load])

  async function handleDelete(id: number) {
    if (!confirm(`确认删除规则 #${id}？`)) return
    try {
      await deleteRule(id)
      load()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          共 {rules?.length ?? '—'} 条规则 · 修改会触发 reload + cache flush
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => setModal({ type: 'create' })}>+ 新建规则</button>
      </div>

      {err && (
        <div style={{ padding: 10, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {!rules ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>
      ) : rules.length === 0 ? (
        <div style={{
          padding: 60, textAlign: 'center', color: 'var(--muted)',
          background: '#f9fafb', border: '1px dashed var(--border)', borderRadius: 12,
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📝</div>
          <div>暂无规则，点右上角新建</div>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr>
              <th style={th}>编号</th>
              <th style={th}>规则描述</th>
              <th style={th}>主体</th>
              <th style={th}>效果</th>
              <th style={th}>操作</th>
              <th style={th}>作用域</th>
              <th style={th}>资源范围</th>
              <th style={th}>附加条件</th>
              <th style={{ ...th, textAlign: 'right' }}>管理</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const eff = (r.effect ?? 'allow') as RuleEffect
              // space-permissions：space_id + subject_type + subject_id 非空 → 由空间成员表投影
              const isProjected = r.space_id != null && !!r.subject_type && !!r.subject_id
              return (
              <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={td}>#{r.id}</td>
                <td style={{ ...td, maxWidth: 320, color: 'var(--text)' }}>
                  <span style={{ fontSize: 12 }}>{describeRule(r, teams)}</span>
                </td>
                <td style={td}>
                  <SubjectBadge r={r} teams={teams} />
                </td>
                <td style={td}>
                  <span style={{
                    padding: '1px 8px', fontSize: 11, borderRadius: 10,
                    background: eff === 'deny' ? '#fee2e2' : '#dcfce7',
                    color: eff === 'deny' ? '#991b1b' : '#166534',
                  }}>{eff === 'deny' ? '拒绝' : '允许'}</span>
                </td>
                <td style={td}>
                  <code style={{ fontSize: 11 }}>{r.permission}</code>
                  <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>
                    {r.permission === 'READ'   ? '查看' :
                     r.permission === 'WRITE'  ? '修改' :
                     r.permission === 'DELETE' ? '删除' :
                     r.permission === 'ADMIN'  ? '全权' : ''}
                  </span>
                </td>
                <td style={td}>
                  {r.space_id == null ? (
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>全局</span>
                  ) : (
                    <span
                      title={isProjected ? '由空间成员表投影生成' : '手发的 space-scoped 规则'}
                      style={{
                        padding: '1px 8px', borderRadius: 10, fontSize: 11,
                        background: isProjected ? '#ede9fe' : '#e0f2fe',
                        color: isProjected ? '#5b21b6' : '#075985',
                      }}
                    >
                      空间 #{r.space_id}{isProjected ? ' · 投影' : ''}
                    </span>
                  )}
                </td>
                <td style={td}>
                  {r.source_id == null && r.asset_id == null
                    ? <span style={{ color: 'var(--muted)' }}>所有</span>
                    : (
                      <>
                        {r.source_id != null && <span>数据源#{r.source_id}</span>}
                        {r.source_id != null && r.asset_id != null && ' · '}
                        {r.asset_id  != null && <span>资产#{r.asset_id}</span>}
                      </>
                    )}
                </td>
                <td style={{ ...td, maxWidth: 200, fontSize: 11, color: 'var(--muted)' }}>
                  {conditionSummary(r.condition)}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button
                    className="btn" style={btnSm}
                    disabled={isProjected}
                    title={isProjected ? '由空间成员表生成，请到 /spaces 改成员' : undefined}
                    onClick={() => setModal({ type: 'edit', rule: r })}
                  >编辑</button>
                  <button className="btn" style={btnSm} onClick={() => setSimulateFor(r)}>试算</button>
                  <button
                    className="btn"
                    style={{ ...btnSm, color: isProjected ? 'var(--muted)' : '#B91C1C' }}
                    disabled={isProjected}
                    title={isProjected ? '由空间成员表生成，请到 /spaces 改成员' : undefined}
                    onClick={() => void handleDelete(r.id)}
                  >删除</button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {modal && (
        <RuleModal
          mode={modal}
          permOptions={permOptions}
          teams={teams}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}

      {simulateFor && (
        <SimulateDrawer rule={simulateFor} teams={teams} onClose={() => setSimulateFor(null)} />
      )}
    </div>
  )
}

function SubjectBadge({ r, teams }: { r: AclRule; teams: TeamSummary[] }) {
  const st = (r.subject_type ?? (r.role ? 'role' : null)) as SubjectType | null
  const sid = r.subject_id ?? r.role ?? null
  if (!st || !sid) {
    return <span style={{ color: 'var(--muted)', fontSize: 11 }}>所有角色</span>
  }
  const isWild = sid === '*'
  let label = sid
  if (st === 'team' && !isWild) {
    const t = teams.find((x) => x.id === Number(sid))
    if (t) label = t.name
  }
  const icon = st === 'role' ? '🛡️' : st === 'user' ? '👤' : '👥'
  return (
    <span title={`${st}=${sid}`} style={{
      padding: '1px 8px', fontSize: 11, borderRadius: 10,
      background: 'var(--p-light)', color: 'var(--p)',
    }}>
      {icon} {isWild ? '*' : label}
    </span>
  )
}

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }
const td: React.CSSProperties = { padding: '8px 10px' }
const btnSm: React.CSSProperties = { padding: '4px 10px', fontSize: 12, marginLeft: 6 }

// ───────────────────────── Rule Modal ─────────────────────────
function deriveSubjectFromExisting(r: AclRule | null): { st: SubjectType; sid: string } {
  if (!r) return { st: 'role', sid: '' }
  if (r.subject_type && r.subject_id != null) {
    return { st: r.subject_type as SubjectType, sid: r.subject_id }
  }
  if (r.role) return { st: 'role', sid: r.role }
  return { st: 'role', sid: '*' }
}

function toLocalDatetimeInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function RuleModal({
  mode, permOptions, teams, onClose, onSaved,
}: {
  mode: Exclude<ModalMode, null>
  permOptions: string[]
  teams: TeamSummary[]
  onClose: () => void
  onSaved: () => void
}) {
  const existing = mode.type === 'edit' ? mode.rule : null
  const init = deriveSubjectFromExisting(existing)
  const [subjectType, setSubjectType] = useState<SubjectType>(init.st)
  const [subjectId, setSubjectId]     = useState<string>(init.sid)
  const [effect, setEffect]           = useState<RuleEffect>(
    (existing?.effect as RuleEffect | undefined) ?? 'allow',
  )
  const [permission, setPerm]   = useState<string>(existing?.permission ?? 'READ')
  const [permissionRequired, setPermRequired] = useState<string>(
    existing?.permission_required ?? '',
  )
  const [sourceId, setSourceId] = useState<string>(existing?.source_id?.toString() ?? '')
  const [assetId, setAssetId]   = useState<string>(existing?.asset_id?.toString() ?? '')
  const [expiresAt, setExpiresAt] = useState<string>(toLocalDatetimeInput(existing?.expires_at))
  const [conditionText, setCondText] = useState<string>(
    existing?.condition ? JSON.stringify(existing.condition, null, 2) : '',
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true); setErr(null)
    try {
      let condition: Record<string, unknown> | null = null
      if (conditionText.trim()) {
        try { condition = JSON.parse(conditionText) }
        catch { throw new Error('condition 必须是合法 JSON') }
      }
      const sid = subjectId.trim()
      if (!sid) throw new Error('请选择/填写主体 ID（或填 *）')
      if (subjectType === 'team' && sid !== '*' && !/^\d+$/.test(sid)) {
        throw new Error('team 主体 ID 必须为数字')
      }
      if (subjectType === 'user' && sid !== '*' && !/^[^@\s]+@[^@\s]+$/.test(sid)) {
        throw new Error('user 主体 ID 必须为邮箱或 *')
      }
      const expIso = expiresAt ? new Date(expiresAt).toISOString() : null
      // permission 校验：收紧到 ACL action 四项
      if (!['READ', 'WRITE', 'DELETE', 'ADMIN'].includes(permission)) {
        throw new Error('permission 只能是 READ / WRITE / DELETE / ADMIN（细粒度请填 permission_required）')
      }
      const pr = permissionRequired.trim()
      const patch: RulePatch = {
        subject_type: subjectType,
        subject_id: sid,
        // 兼容旧字段：role 类型时回写 role
        role: subjectType === 'role' && sid !== '*' ? sid : null,
        effect,
        permission,
        permission_required: pr || null,
        source_id: sourceId ? Number(sourceId) : null,
        asset_id: assetId ? Number(assetId) : null,
        condition,
        expires_at: expIso,
      }
      if (mode.type === 'create') await createRule(patch)
      else await updateRule(existing!.id, patch)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // 主体 ID 输入：role 走 select，user 输邮箱，team 走团队下拉
  const subjectIdInput = (() => {
    if (subjectType === 'role') {
      return (
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={inp}>
          <option value="*">* 所有角色</option>
          <option value="admin">admin</option>
          <option value="editor">editor</option>
          <option value="viewer">viewer</option>
          <option value="user">user</option>
        </select>
      )
    }
    if (subjectType === 'team') {
      return (
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={inp}>
          <option value="">— 请选择团队 —</option>
          <option value="*">* 所有团队</option>
          {teams.map((t) => (
            <option key={t.id} value={String(t.id)}>{t.name}（{t.member_count} 人）</option>
          ))}
        </select>
      )
    }
    // user
    return (
      <input
        value={subjectId} onChange={(e) => setSubjectId(e.target.value)}
        placeholder="user@example.com 或 *"
        style={inp}
      />
    )
  })()

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
          <div style={{ fontWeight: 700 }}>{mode.type === 'create' ? '新建规则' : `编辑规则 #${existing?.id}`}</div>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>取消</button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
            <Field label="主体类型">
              <select
                value={subjectType}
                onChange={(e) => { setSubjectType(e.target.value as SubjectType); setSubjectId('') }}
                style={inp}
              >
                <option value="role">角色 role</option>
                <option value="user">用户 user</option>
                <option value="team">团队 team</option>
              </select>
            </Field>
            <Field label="主体 ID（subject_id；* 表示全部）">
              {subjectIdInput}
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
            <Field label="效果（effect）">
              <select value={effect} onChange={(e) => setEffect(e.target.value as RuleEffect)} style={inp}>
                <option value="allow">allow（允许）</option>
                <option value="deny">deny（拒绝，最高优先）</option>
              </select>
            </Field>
            <Field label="权限（permission · ACL action）">
              <select value={permission} onChange={(e) => setPerm(e.target.value)} style={inp}>
                <option value="READ">READ（查看）</option>
                <option value="WRITE">WRITE（修改）</option>
                <option value="DELETE">DELETE（删除）</option>
                <option value="ADMIN">ADMIN（全权，覆盖 READ/WRITE/DELETE）</option>
              </select>
            </Field>
          </div>
          <Field label="附加细粒度权限（permission_required · 可选；PRD §2 字符串）">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={permissionRequired}
                onChange={(e) => setPermRequired(e.target.value)}
                placeholder="留空 = 不附加；或从右侧下拉选"
                style={{ ...inp, flex: 1, fontFamily: 'monospace' }}
                list="perm-required-options"
              />
              <datalist id="perm-required-options">
                {permOptions.map((p) => <option key={p} value={p} />)}
              </datalist>
              <select
                value=""
                onChange={(e) => { if (e.target.value) setPermRequired(e.target.value) }}
                style={{ ...inp, width: 180 }}
              >
                <option value="">— 选择 PRD 权限 —</option>
                {permOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {permissionRequired && (
                <button
                  type="button" className="btn"
                  onClick={() => setPermRequired('')}
                  title="清空"
                >✕</button>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              设置后 principal 必须同时拥有此细粒度权限才命中（与 action 做 AND 判断；留空 = 只按 action 评估）
            </div>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="source_id（可选）">
              <input value={sourceId} onChange={(e) => setSourceId(e.target.value)} style={inp} type="number" />
            </Field>
            <Field label="asset_id（可选）">
              <input value={assetId} onChange={(e) => setAssetId(e.target.value)} style={inp} type="number" />
            </Field>
          </div>
          <Field label="过期时间（expires_at，可选；留空 = 永久）">
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              style={inp}
            />
          </Field>
          <Field label="condition（JSON，可选；支持 mask/where/project_id 等）">
            <textarea
              value={conditionText}
              onChange={(e) => setCondText(e.target.value)}
              rows={6}
              style={{ ...inp, fontFamily: 'monospace', fontSize: 12 }}
              placeholder='{"mask":[{"field":"cost_price","mode":"star"}]}'
            />
          </Field>
          {err && <div style={{ padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12 }}>{err}</div>}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
          <button className="btn" disabled={saving} onClick={() => void handleSave()}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── Simulate Drawer ─────────────────────────
function SimulateDrawer({ rule, teams, onClose }: { rule: AclRule; teams: TeamSummary[]; onClose: () => void }) {
  // 兼容 V2：role 主体仍可作为模拟身份；user/team 主体则保留默认 editor
  const initRoles =
    rule.subject_type === 'role' && rule.subject_id && rule.subject_id !== '*'
      ? [rule.subject_id]
      : rule.role ? [rule.role] : ['editor']
  const [roles, setRoles] = useState<string[]>(initRoles)
  const [action, setAction] = useState<string>(rule.permission === 'ADMIN' ? 'READ' : rule.permission)
  const [sourceId, setSourceId] = useState<string>(rule.source_id?.toString() ?? '')
  const [assetId, setAssetId] = useState<string>(rule.asset_id?.toString() ?? '')
  const [projectId, setProjectId] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SimulateResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [matrix, setMatrix] = useState<RoleMatrix | null>(null)

  // 拉一次 role → permissions 矩阵用于实时展示
  useEffect(() => {
    getRoleMatrix().then(setMatrix).catch(() => setMatrix(null))
  }, [])

  // 当前 roles 展开后的 permissions 集合（去重）
  const derivedPerms = (() => {
    if (!matrix) return null
    const s = new Set<string>()
    for (const r of roles) {
      const ps = matrix.matrix[r]
      if (ps) ps.forEach((p) => s.add(p))
    }
    return [...s].sort()
  })()

  const allRoles = matrix?.roles ?? ['admin', 'editor', 'viewer', 'user']

  function toggleRole(r: string) {
    if (roles.includes(r)) setRoles(roles.filter((x) => x !== r))
    else setRoles([...roles, r])
  }

  async function handleRun() {
    setRunning(true); setErr(null); setResult(null)
    try {
      const principal: SimulatePrincipal = { user_id: 0, email: 'sim@local', roles }
      const resource: Record<string, unknown> = {}
      if (sourceId)  resource.source_id = Number(sourceId)
      if (assetId)   resource.asset_id  = Number(assetId)
      if (projectId) resource.project_id = projectId
      const r = await simulateRule(principal, action, resource)
      setResult(r)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={overlay}>
      <div style={{ ...modalBox, maxWidth: 760 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
          <div style={{ fontWeight: 700 }}>🧪 规则试算 · #{rule.id}</div>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>关闭</button>
        </div>
        <div style={{ padding: 20 }}>
          {/* 规则白话描述 */}
          <div style={{
            padding: 12, marginBottom: 14,
            background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 8,
            fontSize: 13, color: '#4c1d95',
          }}>
            <div style={{ fontSize: 11, color: '#6d28d9', marginBottom: 4 }}>正在试算的规则</div>
            <div style={{ fontWeight: 600 }}>{describeRule(rule, teams)}</div>
          </div>

          {/* 模拟身份 */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>模拟登录身份 · 角色（多选）</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {allRoles.map((r) => {
                const on = roles.includes(r)
                return (
                  <button
                    key={r}
                    onClick={() => toggleRole(r)}
                    style={{
                      padding: '4px 12px', borderRadius: 16, cursor: 'pointer',
                      background: on ? 'var(--p)' : '#fff',
                      color: on ? '#fff' : 'var(--text)',
                      border: `1px solid ${on ? 'var(--p)' : 'var(--border)'}`,
                      fontSize: 12,
                    }}
                  >{r}</button>
                )
              })}
            </div>

            {/* 派生权限预览 */}
            {derivedPerms && (
              <div style={{
                marginTop: 10, padding: 10, borderRadius: 8,
                background: '#f9fafb', border: '1px solid var(--border)',
                fontSize: 12,
              }}>
                <div style={{ color: 'var(--muted)', marginBottom: 6 }}>
                  该身份拥有 <strong>{derivedPerms.length}</strong> 项权限（由角色展开得到）：
                </div>
                {derivedPerms.length === 0 ? (
                  <span style={{ color: 'var(--muted)' }}>— 无 —</span>
                ) : (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {derivedPerms.map((p) => (
                      <code key={p} style={{
                        padding: '1px 8px', borderRadius: 10, fontSize: 11,
                        background: 'var(--p-light)', color: 'var(--p)',
                      }}>{p}</code>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 动作 + 资源 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <Field label="想做什么操作">
              <select value={action} onChange={(e) => setAction(e.target.value)} style={inp}>
                {['READ','WRITE','DELETE','ADMIN'].map((a) => (
                  <option key={a} value={a}>{ACTION_LABEL[a]}</option>
                ))}
              </select>
            </Field>
            <Field label="数据源 ID（source_id，可选）">
              <input value={sourceId} onChange={(e) => setSourceId(e.target.value)} style={inp} type="number" placeholder="留空 = 任意" />
            </Field>
            <Field label="资产 ID（asset_id，可选）">
              <input value={assetId} onChange={(e) => setAssetId(e.target.value)} style={inp} type="number" placeholder="留空 = 任意" />
            </Field>
            <Field label="项目 ID（condition 评估用，可选）">
              <input value={projectId} onChange={(e) => setProjectId(e.target.value)} style={inp} placeholder="如：T1" />
            </Field>
          </div>

          <button className="btn btn-primary" disabled={running || roles.length === 0} onClick={() => void handleRun()}>
            {running ? '执行中…' : '▶ 运行试算'}
          </button>
          {err && <div style={{ marginTop: 12, padding: 8, background: '#FEF2F2', color: '#B91C1C', borderRadius: 6, fontSize: 12 }}>{err}</div>}

          {/* 结果 */}
          {result && (
            <div style={{
              marginTop: 16, padding: 14,
              background: result.decision.allow ? '#f0fdf4' : '#FEF2F2',
              border: `2px solid ${result.decision.allow ? '#16a34a' : '#dc2626'}`,
              borderRadius: 10, fontSize: 13,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                {result.decision.allow
                  ? <span style={{ color: '#166534' }}>✓ 允许访问</span>
                  : <span style={{ color: '#991b1b' }}>✗ 拒绝访问</span>}
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 10 }}>
                  耗时 {result.durationMs}ms
                </span>
              </div>
              {!result.decision.allow && result.decision.reason && (
                <div style={{ color: '#991b1b', marginBottom: 6 }}>
                  拒绝原因：{translateReason(result.decision.reason)}
                </div>
              )}
              {result.decision.matchedRuleIds && result.decision.matchedRuleIds.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  命中规则：{result.decision.matchedRuleIds.map((i) => <code key={i} style={{ marginRight: 6 }}>#{i}</code>)}
                </div>
              )}
              {result.decision.filter && (
                <div style={{ marginBottom: 4 }}>
                  自动追加行级过滤：<code>{result.decision.filter.where}</code>
                </div>
              )}
              {result.decision.mask && result.decision.mask.length > 0 && (
                <div>
                  敏感字段脱敏：{result.decision.mask.map((m) => (
                    <code key={m.field} style={{ marginRight: 6 }}>
                      {m.field}（{translateMaskMode(m.mode)}）
                    </code>
                  ))}
                </div>
              )}
              {result.decision.allow
                && !result.decision.filter
                && (!result.decision.mask || result.decision.mask.length === 0)
                && (
                  <div style={{ color: '#166534' }}>
                    无行级过滤 / 无脱敏 —— 完全放行
                  </div>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function translateReason(r: string): string {
  if (r === 'no matching rule') return '没有规则匹配当前身份 + 操作 + 资源组合'
  return r
}

function translateMaskMode(m: string): string {
  switch (m) {
    case 'hide':     return '隐藏'
    case 'star':     return '星号'
    case 'hash':     return '哈希'
    case 'truncate': return '截断'
    default:         return m
  }
}

// ───────────────────────── 辅助 ─────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  )
}

const inp: React.CSSProperties = {
  width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13,
  boxSizing: 'border-box',
}
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 50,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const modalBox: React.CSSProperties = {
  width: '90%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto',
  background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
}
