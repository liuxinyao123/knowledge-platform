import type { PgAssetDetail } from '@/api/assetDirectory'

export default function DetailRagflow({ detail }: { detail: PgAssetDetail }) {
  const a = detail.asset
  const tagsText = (a.tags ?? []).slice(0, 5).join('、') || '（暂无标签）'

  return (
    <div>
      <div style={{
        marginBottom: 16, padding: 12, borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#e6f4ff', border: '1px solid #91d5ff',
      }}>
        <div style={{ fontSize: 13 }}>
          🧠 <strong>语义摘要预览</strong> · 共 {detail.chunks.total} 切片 · 当前展示前 10 条
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>（示例视图）</span>
        </div>
        <button className="btn" disabled style={{ padding: '4px 12px', opacity: 0.6 }}>重新生成</button>
      </div>

      <div style={{
        marginBottom: 16, padding: 12, border: '1px solid var(--border)', borderRadius: 8,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>数据源概述</div>
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>
          {`本资产「${a.name}」隶属于 ${detail.source.name || '未知来源'}（${detail.source.connector ?? 'unknown'}）；当前已索引 ${detail.chunks.total} 个切片，包含 ${detail.images.length} 张图片。主题标签：${tagsText}。`}
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="pill pill-purple" style={{ padding: '2px 10px', borderRadius: 10, fontSize: 11 }}>
            共 {detail.chunks.total} 切片
          </span>
          <span className="pill pill-blue" style={{ padding: '2px 10px', borderRadius: 10, fontSize: 11 }}>
            类型: {a.type || '—'}
          </span>
          <span className="pill" style={{ padding: '2px 10px', borderRadius: 10, fontSize: 11, background: '#fef3c7' }}>
            最近更新 {a.indexed_at ? new Date(a.indexed_at).toLocaleDateString('zh-CN') : '—'}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        知识切片（Chunks）
      </div>

      {detail.chunks.samples.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
          📭 当前没有可用切片
        </div>
      ) : (
        detail.chunks.samples.map((s, i) => (
          <div key={i} style={{
            padding: 12, marginBottom: 8, border: '1px solid var(--border)',
            borderRadius: 8, fontSize: 13,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>
                #{i + 1} <span style={{ color: 'var(--muted)' }}>page {s.page}</span>
              </span>
              <span className="pill" style={{
                padding: '1px 8px', borderRadius: 10, fontSize: 11,
                background: '#e6f4ea', color: '#1e7e34',
              }}>已向量化 · {s.kind || 'generic'}</span>
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
