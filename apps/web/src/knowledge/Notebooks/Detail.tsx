/**
 * /notebooks/:id —— Notebook 详情页
 *
 * 三栏布局：
 *   ┌── Sources (240) ──┬── Chat (flex 1) ──┬── Studio (340) ──┐
 *   │ + 添加资料         │ 历史 message      │ Briefing          │
 *   │ ☑ 文档 A          │ AI bubble + [^N]  │ FAQ               │
 *   │ ...                │ 输入框            │ ...               │
 *   └────────────────────┴────────────────────┴───────────────────┘
 */
import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getNotebook, clearMessages, generateArtifact,
  type NotebookSummary, type NotebookSource, type NotebookMessage,
  type ArtifactKind,
} from '@/api/notebooks'
import SourcesPanel from './SourcesPanel'
import ChatPanel from './ChatPanel'
import StudioPanel from './StudioPanel'
import ShareModal from './ShareModal'
import TemplateHintCard from './TemplateHintCard'

export default function NotebookDetail() {
  const { id } = useParams<{ id: string }>()
  const notebookId = Number(id)
  const navigate = useNavigate()
  const [notebook, setNotebook] = useState<NotebookSummary | null>(null)
  const [sources, setSources] = useState<NotebookSource[]>([])
  const [messages, setMessages] = useState<NotebookMessage[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [highlightedAssetId, setHighlightedAssetId] = useState<number | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  // N-006：模板推荐起手问题预填到 ChatPanel input
  const [chatPrefill, setChatPrefill] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!Number.isFinite(notebookId)) return
    try {
      const d = await getNotebook(notebookId)
      setNotebook(d.notebook)
      setSources(d.sources)
      setMessages(d.messages)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }, [notebookId])

  useEffect(() => { void reload() }, [reload])

  if (!Number.isFinite(notebookId)) {
    return <div className="page-body"><div style={{ color: '#b91c1c' }}>非法 notebook id</div></div>
  }

  return (
    <div className="page-body" style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      paddingBottom: 0,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap', flexShrink: 0,
      }}>
        <div>
          <div className="page-title">
            {err
              ? '加载失败'
              : notebook === null
                ? '加载中…'
                : (notebook.name?.trim() || `（未命名笔记本 · #${notebookId}）`)}
          </div>
          {notebook?.description && (
            <div className="page-sub">{notebook.description}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/notebooks')}>← 返回</button>
          <button className="btn"
                  onClick={async () => {
                    if (messages.length === 0) return
                    if (!confirm('清空当前对话？所有消息会被删除。')) return
                    await clearMessages(notebookId); void reload()
                  }}>清空对话</button>
          <button className="btn primary" onClick={() => setShareOpen(true)}>🔗 共享</button>
        </div>
      </div>

      {err && (
        <div style={{
          padding: 12, marginTop: 8, background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, fontSize: 13, flexShrink: 0,
        }}>{err}</div>
      )}

      {/* N-006：模板推荐提示卡（template_id 存在 + 未 dismiss 时显示）*/}
      {notebook?.template_id && (
        <TemplateHintCard
          notebookId={notebookId}
          templateId={notebook.template_id}
          onTriggerArtifact={async (kind: ArtifactKind) => {
            try {
              await generateArtifact(notebookId, kind)
              // 不自动 reload；StudioPanel 自己 1.5s 轮询会拿到
            } catch (e) {
              setErr(e instanceof Error ? e.message : '触发 artifact 失败')
            }
          }}
          onPickStarter={(q) => setChatPrefill(q)}
        />
      )}

      {/* 三栏 */}
      <div style={{
        flex: 1, marginTop: 12, display: 'grid',
        gridTemplateColumns: '240px 1fr 340px', gap: 12,
        minHeight: 0,
      }}>
        <ColumnCard title="资料">
          <SourcesPanel
            notebookId={notebookId}
            sources={sources}
            highlightedAssetId={highlightedAssetId}
            onChanged={() => void reload()}
          />
        </ColumnCard>

        <ColumnCard title="对话" noPadding>
          <ChatPanel
            notebookId={notebookId}
            messages={messages}
            sources={sources}
            onPersisted={() => void reload()}
            onCitationClick={(assetId) => {
              setHighlightedAssetId(assetId)
              // 5s 后自动取消高亮
              setTimeout(() => setHighlightedAssetId((cur) => cur === assetId ? null : cur), 5000)
            }}
            prefillInput={chatPrefill}
            onPrefillConsumed={() => setChatPrefill(null)}
          />
        </ColumnCard>

        <ColumnCard title="Studio" noPadding>
          <StudioPanel
            notebookId={notebookId}
            sourceAssetIds={sources.map((s) => s.asset_id)}
          />
        </ColumnCard>
      </div>

      <ShareModal
        open={shareOpen}
        notebookId={notebookId}
        notebookName={notebook?.name ?? ''}
        onClose={() => setShareOpen(false)}
      />
    </div>
  )
}

function ColumnCard({
  title, children, noPadding,
}: { title: string; children: React.ReactNode; noPadding?: boolean }) {
  void title  // 视觉上每栏内部已有自己的 header，这里只用作语义；不渲染外标题
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      ...(noPadding ? {} : {}),
    }}>
      {children}
    </div>
  )
}
