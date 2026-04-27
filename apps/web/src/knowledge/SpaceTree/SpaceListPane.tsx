/**
 * SpaceListPane —— 空间列表（左侧）
 *
 * 原型图对应：空间列表 + 分组 + 角色 pill
 * 简化策略：按 my_role 分组（所有者 / 管理员 / 编辑者 / 查看者 / 仅可见），
 *           无 my_role 的 visibility='org' 空间归到"仅可见"。
 */
import type { SpaceSummary, SpaceRole } from '@/api/spaces'

interface Props {
  spaces: SpaceSummary[]
  selectedId: number | null
  onSelect: (id: number) => void
  onCreate: () => void
  loading: boolean
}

const ROLE_LABEL: Record<SpaceRole, string> = {
  owner:  '所有者',
  admin:  '管理员',
  editor: '编辑者',
  viewer: '查看者',
}

const GROUP_ORDER: Array<SpaceRole | 'none'> = ['owner', 'admin', 'editor', 'viewer', 'none']

function groupLabel(r: SpaceRole | 'none'): string {
  if (r === 'none') return '仅可见（非成员）'
  return `我是 ${ROLE_LABEL[r]}`
}

export default function SpaceListPane({ spaces, selectedId, onSelect, onCreate, loading }: Props) {
  // 防御：若上游传入 undefined / 非数组（例如 API 未重启返回异常 shape），不要在 for..of 上崩
  const safeSpaces = Array.isArray(spaces) ? spaces : []
  const groups = new Map<SpaceRole | 'none', SpaceSummary[]>()
  for (const s of safeSpaces) {
    const k: SpaceRole | 'none' = s.my_role ?? 'none'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(s)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>空间列表</div>
        <span style={{ flex: 1 }} />
        <button className="btn" style={{ padding: '2px 10px', fontSize: 12 }} onClick={onCreate}>
          + 新建
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>加载中…</div>}
        {!loading && safeSpaces.length === 0 && (
          <div style={{
            padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 12,
            background: '#f9fafb', border: '1px dashed var(--border)', borderRadius: 10, margin: 10,
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗂️</div>
            <div>暂无空间，点右上「新建」</div>
          </div>
        )}
        {GROUP_ORDER.map((k) => {
          const items = groups.get(k)
          if (!items || items.length === 0) return null
          return (
            <div key={k} style={{ marginBottom: 10 }}>
              <div style={{
                padding: '4px 10px', fontSize: 11, color: 'var(--muted)',
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {groupLabel(k)} · {items.length}
              </div>
              {items.map((s) => {
                const active = s.id === selectedId
                return (
                  <button
                    key={s.id}
                    onClick={() => onSelect(s.id)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 12px', margin: '2px 4px', borderRadius: 8,
                      cursor: 'pointer', border: 'none',
                      background: active ? 'var(--p-light)' : 'transparent',
                      color: active ? 'var(--p)' : 'var(--text)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14 }}>{s.visibility === 'private' ? '🔒' : '📁'}</span>
                      <span style={{ fontWeight: active ? 600 : 500, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.name}
                      </span>
                      {s.my_role && (
                        <span style={{
                          padding: '1px 6px', borderRadius: 8, fontSize: 10,
                          background: active ? '#fff' : 'var(--p-light)',
                          color: 'var(--p)', border: `1px solid ${active ? 'var(--p-light)' : 'transparent'}`,
                        }}>
                          {ROLE_LABEL[s.my_role]}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, paddingLeft: 20 }}>
                      文档 {s.doc_count.toLocaleString()} · 成员 {s.member_count}
                    </div>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
