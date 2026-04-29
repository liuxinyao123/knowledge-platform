/**
 * StudioPanel —— 右栏：Studio 衍生品（N-002 8 类 + N-003 stale 检测）
 *
 * - 列出已生成的 artifacts（按 kind 分组，最新一条置顶）
 * - 「生成」/「重新生成」按钮 → POST /:id/artifacts/:kind → 拿 artifactId → 1.5s 轮询直到 done/failed
 * - 完成后用 MarkdownView 渲染主体
 * - **N-003**：sources 变更后比对 artifact.meta.sources_snapshot，stale → 黄色"已过期"徽标
 */
import { useEffect, useState, useCallback } from 'react'
import {
  listArtifacts, generateArtifact, deleteArtifact,
  type NotebookArtifact, type ArtifactKind,
} from '@/api/notebooks'
import MarkdownView from '@/components/MarkdownView'

interface Props {
  notebookId: number
  /**
   * N-003：从 number sourceCount 升级为 number[] sourceAssetIds
   * 既能用 .length 拿到 count（向后兼容渲染），又能跟 artifact.meta.sources_snapshot
   * 比对推断 isStale。
   */
  sourceAssetIds: number[]
}

/**
 * N-003 · stale 推断：比较 artifact 生成时的 sources_snapshot vs 当前 sources。
 * 任一集合差异 → stale。缺 snapshot（V1 老数据）→ false（避免误报）。
 */
function isArtifactStale(
  artifact: NotebookArtifact,
  currentSourceAssetIds: number[],
): boolean {
  if (artifact.status !== 'done') return false  // 只对 done 状态有 stale 概念
  const snapshot = (artifact.meta?.sources_snapshot ?? []) as Array<{ asset_id: number }>
  if (!Array.isArray(snapshot) || snapshot.length === 0) return false  // 老数据无 snapshot
  const snapshotIds = new Set(snapshot.map((s) => Number(s?.asset_id)).filter(Number.isFinite))
  const currentIds = new Set(currentSourceAssetIds)
  if (snapshotIds.size !== currentIds.size) return true
  for (const id of snapshotIds) if (!currentIds.has(id)) return true
  return false
}

const KINDS: Array<{ id: ArtifactKind; label: string; icon: string; desc: string }> = [
  // V1
  { id: 'briefing',          label: '简报',       icon: '📋', desc: '一份结构化总结：核心论点 / 共识分歧 / 关键数据 / 行动建议' },
  { id: 'faq',               label: 'FAQ',        icon: '❓', desc: '8-12 条最值得关注的 Q&A，覆盖资料的不同方面' },
  // N-002 新增（跟后端 ARTIFACT_REGISTRY 一致）
  { id: 'mindmap',           label: '思维导图',   icon: '🧠', desc: '层级化梳理：中心主题 → 子主题 → 叶节点（markdown 嵌套列表）' },
  { id: 'outline',           label: '大纲',       icon: '📑', desc: '一二三级标题的结构化大纲，每节 1-2 行说明' },
  { id: 'timeline',          label: '时间线',     icon: '⏱️', desc: '按时间顺序排列的事件序列（markdown 表格）' },
  { id: 'comparison_matrix', label: '对比矩阵',   icon: '📊', desc: '多对象 × 多维度对比表（markdown 表格）' },
  { id: 'glossary',          label: '术语表',     icon: '📖', desc: '文档涉及的术语 + 定义列表，按字母 / 拼音序' },
  { id: 'slides',            label: '演示稿大纲', icon: '🎞️', desc: '8-15 张幻灯片大纲（含 speaker notes）' },
]

export default function StudioPanel({ notebookId, sourceAssetIds }: Props) {
  const sourceCount = sourceAssetIds.length
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
              stale={latest ? isArtifactStale(latest, sourceAssetIds) : false}
              currentSourceCount={sourceCount}
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
  kind, latest, stale, currentSourceCount, disabled, onGenerate, onDelete,
}: {
  kind: { id: ArtifactKind; label: string; icon: string; desc: string }
  latest: NotebookArtifact | undefined
  stale: boolean
  currentSourceCount: number
  disabled: boolean
  onGenerate: () => Promise<void>
  onDelete: (id: number) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const status = latest?.status
  const snapshotCount = (latest?.meta?.sources_snapshot as Array<unknown> | undefined)?.length ?? 0
  const staleTooltip = stale
    ? `上次生成基于 ${snapshotCount} 份资料；当前 ${currentSourceCount} 份已变化，建议重新生成`
    : ''

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
        ) : status === 'done' && stale ? (
          // N-003：sources 变更后 stale 徽标
          <span
            title={staleTooltip}
            style={{
              padding: '3px 10px', borderRadius: 999, fontSize: 11,
              background: '#fef3c7', color: '#92400e',
              cursor: 'help',
            }}
          >已过期 ⚠️</span>
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
          title={stale ? staleTooltip : ''}
          style={{
            fontSize: 11, padding: '3px 10px',
            // N-003：stale 时按钮加微强调（黄色边框）提示用户重新生成
            ...(stale && status === 'done' ? {
              borderColor: '#f59e0b',
              color: '#92400e',
              fontWeight: 600,
            } : {}),
          }}
        >{stale && status === 'done' ? '重新生成（已过期）' : status === 'done' ? '重新生成' : '生成'}</button>
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
