/**
 * PermissionsDrawer —— Spaces / Assets 行内权限入口（Permissions V2 · F-2）
 *
 * 对应 spec: openspec/changes/permissions-v2/specs/permissions-drawer-spec.md
 *
 * 约束：
 *   - 仅展示当前资源域 (source_id 或 asset_id) 的规则；不暴露全局规则
 *   - 新增规则时预填 source_id / asset_id 且 disabled（不能被用户取消）
 *   - 删除 / 新增后自动刷新
 *   - ESC 可关闭；未提交的新规则表单关闭时提示（简单 confirm）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listRules, createRule, deleteRule, listPermissions,
  type AclRule, type SubjectType, type RuleEffect,
} from '@/api/iam'
import { listTeams, type TeamSummary } from '@/api/teams'
import SubjectBadge from './SubjectBadge'

type ResourceKind = 'source' | 'asset'

interface Props {
  open: boolean
  resourceKind: ResourceKind
  resourceId: number
  resourceName?: string
  onClose: () => void
}

const ALL_PERMS = ['READ', 'WRITE', 'DELETE', 'ADMIN'] as const

export default function PermissionsDrawer({
  open, resourceKind, resourceId, resourceName, onClose,
}: Props) {
  const [rules, setRules] = useState<AclRule[] | null>(null)
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [permOptions, setPermOptions] = useState<string[]>([])  // PRD §2 细粒度权限
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  // form state
  const [subjectType, setSubjectType] = useState<SubjectType>('role')
  const [subjectId, setSubjectId] = useState('')
  const [permissionRequired, setPermissionRequired] = useState<string>('')
  const [permission, setPermission] = useState<'READ' | 'WRITE' | 'ADMIN'>('READ')
  const [effect, setEffect] = useState<RuleEffect>('allow')
  const [expiresAt, setExpiresAt] = useState('')

  const load = useCallback(async () => {
    if (!open) return
    try {
      const filter = resourceKind === 'source'
        ? { source_id: resourceId }
        : { asset_id: resourceId }
      const [rs, ts, ps] = await Promise.all([
        listRules(filter),
        listTeams(),
        listPermissions().catch(() => [] as string[]),
      ])
      setRules(rs)
      setTeams(ts)
      setPermOptions(ps)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }, [open, resourceKind, resourceId])

  useEffect(() => {
    if (!open) return
    setFormOpen(false)
    setSubjectType('role')
    setSubjectId('')
    setPermission('READ')
    setPermissionRequired('')
    setEffect('allow')
    setExpiresAt('')
    setErr(null)
    void load()
  }, [open, load])

  // ESC 关闭
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function handleAdd() {
    const sid = subjectId.trim()
    if (!sid) { setErr('请填主体'); return }
    if (subjectType === 'user' && !/^[^@\s]+@[^@\s]+$/.test(sid)) {
      setErr('邮箱格式不正确'); return
    }
    setBusy(true); setErr(null)
    try {
      await createRule({
        source_id: resourceKind === 'source' ? resourceId : null,
        asset_id:  resourceKind === 'asset'  ? resourceId : null,
        subject_type: subjectType,
        subject_id: sid,
        permission,
        permission_required: permissionRequired.trim() || null,
        effect,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      })
      setFormOpen(false)
      setSubjectId('')
      setPermissionRequired('')
      setExpiresAt('')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(r: AclRule) {
    if (!confirm(`确认删除规则 #${r.id}？`)) return
    try {
      await deleteRule(r.id)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败')
    }
  }

  if (!open) return null

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
        zIndex: 9999, display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        role="dialog"
        aria-label="权限抽屉"
        style={{
          width: 520, maxWidth: '100%', height: '100%',
          background: 'var(--bg, #fff)', padding: 20,
          boxShadow: '-4px 0 12px rgba(0,0,0,0.1)',
          overflowY: 'auto',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 16,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>权限</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {resourceKind}#{resourceId}{resourceName ? ` · ${resourceName}` : ''}
            </div>
          </div>
          <button className="btn" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {err && (
          <div style={{
            padding: 8, marginBottom: 12, color: '#B91C1C',
            background: '#FEE2E2', borderRadius: 4, fontSize: 13,
          }}>
            {err}
          </div>
        )}

        {/* 规则列表 */}
        <div style={{ marginBottom: 16 }}>
          {rules == null ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>
          ) : rules.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>
              暂无针对此资源的规则
            </div>
          ) : (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-2, #f5f5f5)' }}>
                  <th style={cellStyle}>主体</th>
                  <th style={cellStyle}>权限</th>
                  <th style={cellStyle}>效果</th>
                  <th style={cellStyle}>过期</th>
                  <th style={cellStyle}></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                    <td style={cellStyle}>
                      <SubjectBadge
                        subject_type={r.subject_type ?? null}
                        subject_id={r.subject_id ?? null}
                        legacyRole={r.role}
                      />
                    </td>
                    <td style={cellStyle}>{r.permission}</td>
                    <td style={cellStyle}>
                      <span style={effectBadgeStyle(r.effect)}>
                        {r.effect ?? 'allow'}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      {r.expires_at ? new Date(r.expires_at).toLocaleString() : '—'}
                    </td>
                    <td style={cellStyle}>
                      <button className="btn" onClick={() => handleDelete(r)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 新增规则 */}
        {!formOpen ? (
          <button className="btn primary" onClick={() => setFormOpen(true)}>
            + 新增规则
          </button>
        ) : (
          <div style={{
            padding: 12, border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 6, background: 'var(--bg-2, #fafafa)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>新增规则</div>

            {/* 资源（锁定） */}
            <div style={formRow}>
              <label style={formLabel}>资源</label>
              <input
                type="text"
                value={`${resourceKind}_id = ${resourceId}`}
                disabled
                style={{ ...formInput, background: '#e5e7eb', color: '#6B7280' }}
              />
            </div>

            {/* 主体类型 */}
            <div style={formRow}>
              <label style={formLabel}>主体类型</label>
              <select
                value={subjectType}
                onChange={(e) => { setSubjectType(e.target.value as SubjectType); setSubjectId('') }}
                style={formInput}
              >
                <option value="role">role</option>
                <option value="user">user</option>
                <option value="team">team</option>
              </select>
            </div>

            {/* 主体值 */}
            <div style={formRow}>
              <label style={formLabel}>主体</label>
              {subjectType === 'team' ? (
                <select
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  style={formInput}
                >
                  <option value="">—请选择团队—</option>
                  {teams.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.name} (#{t.id})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder={subjectType === 'role' ? 'editor / viewer / admin / *' : 'email'}
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  style={formInput}
                />
              )}
            </div>

            {/* 权限（ACL action） */}
            <div style={formRow}>
              <label style={formLabel}>permission</label>
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value as typeof permission)}
                style={formInput}
              >
                {ALL_PERMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            {/* 附加细粒度权限（可选） */}
            <div style={formRow}>
              <label style={formLabel} title="PRD §2 细粒度权限；principal 必须同时拥有才命中">
                permission_required
              </label>
              <input
                type="text"
                list="drawer-perm-required"
                placeholder="可选，留空 = 不附加"
                value={permissionRequired}
                onChange={(e) => setPermissionRequired(e.target.value)}
                style={{ ...formInput, fontFamily: 'monospace' }}
              />
              <datalist id="drawer-perm-required">
                {permOptions.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>

            {/* 效果 */}
            <div style={formRow}>
              <label style={formLabel}>effect</label>
              <select
                value={effect}
                onChange={(e) => setEffect(e.target.value as RuleEffect)}
                style={formInput}
              >
                <option value="allow">allow</option>
                <option value="deny">deny</option>
              </select>
            </div>

            {/* 过期 */}
            <div style={formRow}>
              <label style={formLabel}>expires_at</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                style={formInput}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary" disabled={busy} onClick={handleAdd}>
                {busy ? '提交中…' : '保存'}
              </button>
              <button className="btn" onClick={() => setFormOpen(false)}>取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── styles ──
const cellStyle: React.CSSProperties = { padding: '6px 8px', textAlign: 'left' }
const formRow: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 8 }
const formLabel: React.CSSProperties = { width: 100, fontSize: 12, color: 'var(--muted)' }
const formInput: React.CSSProperties = { flex: 1, padding: '4px 8px', fontSize: 13 }

function effectBadgeStyle(effect: string | null | undefined): React.CSSProperties {
  const isDeny = effect === 'deny'
  return {
    padding: '1px 6px',
    borderRadius: 3,
    background: isDeny ? '#FEE2E2' : '#D1FAE5',
    color: isDeny ? '#991B1B' : '#065F46',
    fontSize: 11,
    fontWeight: 600,
  }
}
