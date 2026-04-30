import { useTranslation } from 'react-i18next'
import type { PgAssetDetail } from '@/api/assetDirectory'

export default function DetailRagflow({ detail }: { detail: PgAssetDetail }) {
  const { t } = useTranslation('assets')
  const a = detail.asset
  const tagsText = (a.tags ?? []).slice(0, 5).join(t('ragflow.tagSeparator')) || t('ragflow.noTags')

  return (
    <div>
      <div style={{
        marginBottom: 16, padding: 12, borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#e6f4ff', border: '1px solid #91d5ff',
      }}>
        <div style={{ fontSize: 13 }}>
          🧠 <strong>{t('ragflow.previewTitle')}</strong> · {t('ragflow.previewMeta', { total: detail.chunks.total })}
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>{t('ragflow.previewSample')}</span>
        </div>
        <button className="btn" disabled style={{ padding: '4px 12px', opacity: 0.6 }}>{t('ragflow.regenerate')}</button>
      </div>

      <div style={{
        marginBottom: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 8,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('ragflow.sourceOverview')}</div>
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>
          {t('ragflow.summary', {
            name: a.name,
            source: detail.source.name || t('ragflow.unknownSource'),
            connector: detail.source.connector ?? 'unknown',
            chunks: detail.chunks.total,
            images: detail.images.length,
            tags: tagsText,
          })}
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="pill pill-purple" style={{ padding: '2px 10px', borderRadius: 10, fontSize: 11 }}>
            {t('ragflow.pillChunks', { total: detail.chunks.total })}
          </span>
          <span className="pill pill-blue" style={{ padding: '2px 10px', borderRadius: 10, fontSize: 11 }}>
            {t('ragflow.pillType', { type: a.type || '—' })}
          </span>
          <span className="pill" style={{ padding: '2px 10px', borderRadius: 10, fontSize: 11, background: '#fef3c7' }}>
            {t('ragflow.pillUpdated', { date: a.indexed_at ? new Date(a.indexed_at).toLocaleDateString() : '—' })}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        {t('ragflow.chunksHeader')}
      </div>

      {detail.chunks.samples.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
          {t('ragflow.noChunks')}
        </div>
      ) : (
        detail.chunks.samples.map((s, i) => (
          <div key={i} style={{
            padding: 12, marginBottom: 8, border: '1px solid var(--border)',
            borderRadius: 8, fontSize: 13,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>
                #{i + 1} <span style={{ color: 'var(--muted)' }}>{t('ragflow.chunkPage', { page: s.page })}</span>
              </span>
              <span className="pill" style={{
                padding: '1px 8px', borderRadius: 10, fontSize: 11,
                background: '#e6f4ea', color: '#1e7e34',
              }}>{t('ragflow.vectorized', { kind: s.kind || 'generic' })}</span>
            </div>
            <div style={{ color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {s.text.slice(0, 240)}{s.text.length > 240 ? '...' : ''}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
