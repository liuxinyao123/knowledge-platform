/**
 * FileSourceForm —— 新建/编辑 SMB 文件服务器接入点
 * 本轮只实现 SMB；S3/WebDAV/SFTP 的字段后续 change 加
 */
import { useState } from 'react'
import {
  fileSourceApi, type FileSource, type CreateFileSourceInput, type FileSourceType,
} from '@/api/fileSource'

interface Props {
  existing?: FileSource
  onDone: (s: FileSource) => void
  onCancel: () => void
}

const CRON_PRESETS = [
  { label: '手动触发（不定时）', value: '@manual' },
  { label: '每 15 分钟', value: '*/15 * * * *' },
  { label: '每小时', value: '0 * * * *' },
  { label: '每 6 小时', value: '0 */6 * * *' },
  { label: '每天凌晨 3 点', value: '0 3 * * *' },
]

export default function FileSourceForm({ existing, onDone, onCancel }: Props) {
  const edit = !!existing
  const [type] = useState<FileSourceType>(existing?.type ?? 'smb')
  const [name, setName] = useState(existing?.name ?? '')
  const [cron, setCron] = useState(existing?.cron ?? '@manual')
  const [permissionSourceId, setPermissionSourceId] = useState<string>(
    existing?.permission_source_id != null ? String(existing.permission_source_id) : '',
  )
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)

  // SMB 字段（从 existing.config_json 回填，password 字段在编辑态显示为 ***）
  const existingCfg = (existing?.config_json ?? {}) as Record<string, unknown>
  const [host,     setHost]     = useState<string>(String(existingCfg.host     ?? ''))
  const [share,    setShare]    = useState<string>(String(existingCfg.share    ?? ''))
  const [path,     setPath]     = useState<string>(String(existingCfg.path     ?? '/'))
  const [domain,   setDomain]   = useState<string>(String(existingCfg.domain   ?? ''))
  const [username, setUsername] = useState<string>(String(existingCfg.username ?? ''))
  const [password, setPassword] = useState('')
  const [maxFileMb, setMaxFileMb] = useState<string>(String(existingCfg.max_file_mb ?? 200))

  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function buildConfig(): Record<string, unknown> {
    const c: Record<string, unknown> = {
      host: host.trim(),
      share: share.trim(),
      path: path.trim() || '/',
      username: username.trim(),
      max_file_mb: Math.max(1, Number(maxFileMb) || 200),
    }
    if (domain.trim()) c.domain = domain.trim()
    if (password && password !== '***') c.password = password
    return c
  }

  async function submit() {
    setErr(null)
    if (!name.trim()) { setErr('请填写接入点名称'); return }
    if (!host.trim() || !share.trim() || !username.trim()) {
      setErr('host / share / username 不能为空'); return
    }
    if (!edit && !password) {
      setErr('首次创建必须填写密码'); return
    }
    setBusy(true)
    try {
      if (edit && existing) {
        const r = await fileSourceApi.patch(existing.id, {
          name: name.trim(),
          cron,
          permission_source_id: permissionSourceId ? Number(permissionSourceId) : null,
          enabled,
          config_json: buildConfig(),
        })
        onDone(r)
      } else {
        const body: CreateFileSourceInput = {
          type,
          name: name.trim(),
          config_json: buildConfig(),
          cron,
          permission_source_id: permissionSourceId ? Number(permissionSourceId) : null,
          enabled,
        }
        const r = await fileSourceApi.create(body)
        onDone(r)
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } }; message?: string })
        ?.response?.data?.error?.message
        ?? (e as Error).message
        ?? '保存失败'
      setErr(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="surface-card" style={{ padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
        {edit ? `编辑接入点 #${existing!.id}` : '新建文件服务器接入点'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, fontSize: 13 }}>
        <label style={{ alignSelf: 'center' }}>协议</label>
        <div><span className="pill">SMB / CIFS</span></div>

        <label style={{ alignSelf: 'center' }}>名称 *</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：NAS 工程文档" />

        <label style={{ alignSelf: 'center' }}>主机 *</label>
        <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="nas.corp.local 或 192.168.1.10" />

        <label style={{ alignSelf: 'center' }}>共享名 *</label>
        <input className="input" value={share} onChange={(e) => setShare(e.target.value)} placeholder="docs" />

        <label style={{ alignSelf: 'center' }}>起始路径</label>
        <input className="input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/engineering/specs" />

        <label style={{ alignSelf: 'center' }}>域 (可选)</label>
        <input className="input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="CORP" />

        <label style={{ alignSelf: 'center' }}>用户名 *</label>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />

        <label style={{ alignSelf: 'center' }}>密码 {edit ? '' : '*'}</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={edit ? '留空保持不变' : '首次创建必填'}
        />

        <label style={{ alignSelf: 'center' }}>单文件上限 (MB)</label>
        <input className="input" type="number" value={maxFileMb} onChange={(e) => setMaxFileMb(e.target.value)} />

        <label style={{ alignSelf: 'center' }}>扫描周期</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="input" value={cron} onChange={(e) => setCron(e.target.value)} style={{ width: 220 }}>
            {CRON_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            {!CRON_PRESETS.some((p) => p.value === cron) && <option value={cron}>自定义：{cron}</option>}
          </select>
          <input
            className="input"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            style={{ flex: 1, minWidth: 180 }}
            placeholder="自定义 cron 表达式"
          />
        </div>

        <label style={{ alignSelf: 'center' }}>权限源 (source_id)</label>
        <input
          className="input"
          type="number"
          value={permissionSourceId}
          onChange={(e) => setPermissionSourceId(e.target.value)}
          placeholder="metadata_source.id，决定谁能读这批文件"
        />

        <label style={{ alignSelf: 'center' }}>启用</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>定时扫描按 cron 运行；关闭后仅手动扫生效</span>
        </label>
      </div>

      {err && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 6, fontSize: 13 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel} disabled={busy}>取消</button>
        <button className="btn primary" onClick={() => void submit()} disabled={busy}>
          {busy ? '保存中…' : edit ? '保存修改' : '创建'}
        </button>
      </div>
    </div>
  )
}
