/**
 * /ingest —— PRD §7 入库页（按原型 §page-knowledge-ingest 重做）
 *
 * 布局：
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ 入库方式（4 sub-tabs）         │ 入库配置（共享）                 │
 *   │ ┌──────────────────────────┐  │ ┌────────────────────────────┐  │
 *   │ │ Upload / FetchUrl /      │  │ │ 目标空间 / 标签 / 策略 /    │  │
 *   │ │ Conversation / Batch     │  │ │ 向量化 toggle              │  │
 *   │ └──────────────────────────┘  │ └────────────────────────────┘  │
 *   ├─────────────────────────────────────────────────────────────────┤
 *   │ 任务队列（处理中 N · 失败 N · 完成 N）                            │
 *   └─────────────────────────────────────────────────────────────────┘
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import IngestConfigPanel, { DEFAULT_INGEST_CONFIG, type IngestConfig } from './IngestConfigPanel'
import JobQueue from './JobQueue'
import PreprocessingModule from './PreprocessingModule'
import UploadTab from './UploadTab'
import FetchUrlTab from './FetchUrlTab'
import ConversationTab from './ConversationTab'
import BatchTab from './BatchTab'

type TabId = 'upload' | 'fetch-url' | 'conversation' | 'batch'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'upload',       label: '文件上传' },
  { id: 'fetch-url',    label: '网页抓取' },
  { id: 'conversation', label: '对话沉淀' },
  { id: 'batch',        label: '批量任务' },
]

export default function Ingest() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabId>('upload')
  const [config, setConfig] = useState<IngestConfig>(DEFAULT_INGEST_CONFIG)
  const [refreshTick, setRefreshTick] = useState(0)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const onSubmitted = () => setRefreshTick((n) => n + 1)

  return (
    <div className="page-body">
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">知识入库</div>
          <div className="page-sub">
            文件 · 网页 · 对话沉淀 · 批量任务，实时任务队列与预处理流水线
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/overview')}>返回运行概览</button>
          <button className="btn" onClick={() => navigate('/assets')}>查看资产目录</button>
          <button className="btn primary" onClick={onSubmitted}>开始入库</button>
        </div>
      </div>

      <KnowledgeTabs />

      {/* 上半区：入库方式 + 入库配置（对齐原型 .kc-grid-2 + .surface-card） */}
      <div className="kc-grid-2">
        {/* 左：入库方式 */}
        <div className="surface-card" style={{
          padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 8,
          }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--muted)' }}>入库方式</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-testid={`tab-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`pill${tab === t.id ? ' active' : ''}`}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {tab === 'upload'       && <UploadTab       config={config} onSubmitted={onSubmitted} />}
          {tab === 'fetch-url'    && <FetchUrlTab     config={config} onSubmitted={onSubmitted} />}
          {tab === 'conversation' && <ConversationTab config={config} onSubmitted={onSubmitted} />}
          {tab === 'batch'        && <BatchTab />}
        </div>

        {/* 右：入库配置 */}
        <IngestConfigPanel value={config} onChange={setConfig} />
      </div>

      {/* 中段：数据预处理模块（按选中 / 冒泡的 jobId 渲染） */}
      <PreprocessingModule jobId={selectedJobId ?? undefined} variant="embedded" />

      {/* 下半区：任务队列（行可点选切换 PreprocessingModule） */}
      <JobQueue
        refreshKey={refreshTick}
        selectedId={selectedJobId}
        onSelect={setSelectedJobId}
      />
    </div>
  )
}
