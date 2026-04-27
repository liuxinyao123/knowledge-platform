/**
 * StudioPanel —— 右栏：Studio 衍生品（V1：Briefing + FAQ）
 *
 * - 列出已生成的 artifacts（按 kind 分组，最新一条置顶）
 * - 「生成」/「重新生成」按钮 → POST /:id/artifacts/:kind → 拿 artifactId → 1.5s 轮询直到 done/failed
 * - 完成后用 MarkdownView 渲染主体
 */
import { useEffect, useState, useCallback } from 'react'
import {
  listArtifacts, generateArtifact, deleteArtifact,
  type NotebookArtifact, type ArtifactKind,
} from '@/api/notebooks'
import MarkdownView from '@/components/MarkdownView'

interface Props {
  notebookId: number
  sourceCount: number
}

const KINDS: Array<{ id: ArtifactKind; label: string; icon: string; desc: string }> = [
  { id: 'briefing', label: '简报',  icon: '📋', desc: '一份结构化总结：核心论点 / 共识分歧 / 关键数据 / 行动建议' },
  { id: 'faq',      label: 'FAQ',  icon: '❓', desc: '8-12 条最值得关注的 Q&A，覆盖资料的不同方面' },
]

export default function StudioPanel({ notebookId, sourceCount }: Props) {
  const [artifacts, setArtifacts] = useState<NotebookArtifact[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const list = await listArtifacts(notebookId)
      setArtifacts(list); setErr(null)
    } catch (e) {
      setArtifacts((p) => p ?? [])
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }, [notebookId])

  useEffect(() => { void reload() }, [reload])

  // 任意 artifact 处于 pending/running 时 1.5s 轮询
  useEffect(() => {
    if (!artifacts?.some((a) => a.status === 'pending' || a.status === 'running')) return
    const t = setInterval(() => { void reload() }, 1500)
    return () => clearInterval(t)
  }, [artifacts, reload])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Studio</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {sourceCount === 0 ? '需先添加资料' : `基于 ${sourceCount} 份资料生成`}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {err && (
          <div style={{ padding: 10, marginBottom: 8, background: '#fee2e2', color: '#b91c1c', borderRadius: 8, fontSize: 12 }}>
            {err}
          </div>
        )}

        {KINDS.map((k) => {
          const list = (artifacts ?? []).filter((a) => a.kind === k.id)
          const latest = list[0]   // 后端按 id DESC 排
          return (
            <ArtifactCard
              key={k.id}
              kind={k}
              latest={latest}
              disabled={sourceCount === 0}
              onGenerate={async () => {
                try { await generateArtifact(notebookId, k.id); void reload() }
                catch (e) { setErr(e instanceof Error ? e.message : '触发失败') }
              }}
              onDelete={async (id) => {
                if (!confirm(`删除这次生成的${k.label}？`)) return
                await deleteArtifact(notebookId, id); void reload()
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function ArtifactCard({
  kind, latest, disabled, onGenerate, onDelete,
}: {
  kind: { id: ArtifactKind; label: string; icon: string; desc: string }
  latest: NotebookArtifact | undefined
  disabled: boolean
  onGenerate: () => Promise<void>
  onDelete: (id: number) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const status = latest?.status

  return (
    <div style={{
      background: '#fff', border: '1px solid var(--border)', borderRadius: 10,
      marginBottom: 10, overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 18 }}>{kind.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{kind.label}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{kind.desc}</div>
        </div>
      </div>

      <div style={{
        padding: '0 12px 10px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {status === 'pending' || status === 'running' ? (
          <span style={{
            padding: '3px 10px', borderRadius: 999, fontSize: 11,
            background: '#d1fae5', color: '#047857',
          }}>生成中…</span>
        ) : status === 'failed' ? (
          <span style={{
            padding: '3px 10px', borderRadius: 999, fontSize: 11,
            background: '#fee2e2', color: '#b91c1c',
          }}>失败</span>
        ) : status === 'done' ? (
          <span style={{
            padding: '3px 10px', borderRadius: 999, fontSize: 11,
            background: '#dbeafe', color: '#1e40af',
          }}>已完成</span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>未生成</span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn"
          disabled={disabled || status === 'pending' || status === 'running'}
          onClick={() => void onGenerate()}
          style={{ fontSize: 11, padding: '3px 10px' }}
        >{status === 'done' ? '重新生成' : '生成'}</button>
        {status === 'done' && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            style={{
              background: 'transparent', border: 'none', color: 'var(--p, #6C47FF)',
              fontSize: 11, cursor: 'pointer', padding: '3px 6px',
            }}
          >{open ? '收起' : '展开 ↓'}</button>
        )}
      </div>

      {status === 'failed' && latest?.error && (
        <div style={{
          margin: '0 12px 10px', padding: 8,
          background: '#fef2f2', color: '#b91c1c', fontSize: 11, borderRadius: 6,
        }}>{latest.error}</div>
      )}

      {open && status === 'done' && latest?.content && (
        <div style={{
          padding: '12px 14px', borderTop: '1px solid var(--border)',
          maxHeight: 480, overflowY: 'auto',
          background: '#fafafa',
        }}>
          <MarkdownView source={latest.content} />
          <div style={{
            display: 'flex', justifyContent: 'flex-end',
            marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)',
          }}>
            <button type="button"
                    onClick={() => void onDelete(latest.id)}
                    style={{
                      background: 'transparent', border: 'none', color: '#b91c1c',
                      fontSize: 11, cursor: 'pointer', padding: 0,
                    }}>删除此次生成</button>
          </div>
        </div>
      )}
    </div>
  )
}
