/**
 * KnowledgeOps —— 知识治理 4 子 Tab 容器（PRD §9.1）
 * 标签体系 / 重复检测 / 质量评分 / 审计日志
 */
import { useState } from 'react'
import TagsPanel from './TagsPanel'
import DuplicatesPanel from './DuplicatesPanel'
import QualityPanel from './QualityPanel'
import AuditLogPanel from './AuditLogPanel'

type SubTab = 'tags' | 'duplicates' | 'quality' | 'audit'

const TABS: Array<{ id: SubTab; label: string; icon: string }> = [
  { id: 'tags', label: '标签体系', icon: '🏷' },
  { id: 'duplicates', label: '重复检测', icon: '🔁' },
  { id: 'quality', label: '质量评分', icon: '📊' },
  { id: 'audit', label: '审计日志', icon: '📜' },
]

export default function KnowledgeOps() {
  const [tab, setTab] = useState<SubTab>('tags')
  return (
    <div data-testid="tab-content-knowledge">
      <div style={{
        display: 'flex', gap: 4, marginBottom: 16,
        borderBottom: '1px solid var(--border)',
      }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-testid={`subtab-${t.id}`}
            style={{
              padding: '8px 16px', border: 'none', background: 'none',
              fontSize: 13, cursor: 'pointer',
              color: tab === t.id ? 'var(--p)' : 'var(--muted)',
              borderBottom: tab === t.id ? '2px solid var(--p)' : '2px solid transparent',
              fontWeight: tab === t.id ? 600 : 400,
              marginBottom: -1,
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div style={{ minHeight: 300 }}>
        {tab === 'tags' && <TagsPanel />}
        {tab === 'duplicates' && <DuplicatesPanel />}
        {tab === 'quality' && <QualityPanel />}
        {tab === 'audit' && <AuditLogPanel />}
      </div>
    </div>
  )
}
