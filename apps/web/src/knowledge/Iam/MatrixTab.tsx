/**
 * MatrixTab —— 角色 × 权限矩阵（只读）
 */
import { useEffect, useState } from 'react'
import { type RoleMatrix, getRoleMatrix } from '@/api/iam'

export default function MatrixTab() {
  const [data, setData] = useState<RoleMatrix | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    getRoleMatrix().then(setData).catch((e) =>
      setErr(e?.response?.data?.error || e?.message || '加载失败'),
    )
  }, [])

  if (err) return <div style={{ padding: 10, color: '#B91C1C' }}>{err}</div>
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>

  return (
    <div>
      <div style={{
        marginBottom: 12, padding: 10, borderRadius: 8,
        background: '#f0f9ff', border: '1px solid #bae6fd',
        fontSize: 12, color: '#0369a1',
      }}>
        💡 来源：后端常量 <code>ROLE_TO_PERMS</code>（apps/qa-service/src/auth/permissions.ts）。
        修改此常量需重启 qa-service 本表才会更新。
      </div>

      <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr>
              <th style={{ ...th, minWidth: 200, position: 'sticky', left: 0, background: '#f9fafb' }}>permission</th>
              {data.roles.map((r) => (
                <th key={r} style={{ ...th, textAlign: 'center', minWidth: 80 }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 11,
                    background: 'var(--p-light)', color: 'var(--p)',
                  }}>{r}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.permissions.map((perm) => (
              <tr key={perm} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ ...td, fontFamily: 'monospace', position: 'sticky', left: 0, background: '#fff' }}>
                  {perm}
                </td>
                {data.roles.map((r) => (
                  <td key={r} style={{ ...td, textAlign: 'center' }}>
                    {data.matrix[r]?.includes(perm)
                      ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓</span>
                      : <span style={{ color: '#cbd5e1' }}>·</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)' }}>
        共 {data.permissions.length} 个权限 × {data.roles.length} 个角色。
        用户登录时如果携带的 roles 在此表中，会自动展开为对应的 permissions 集合。
      </div>
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)',
  fontSize: 12, color: 'var(--muted)', fontWeight: 600,
}
const td: React.CSSProperties = { padding: '8px 12px' }
