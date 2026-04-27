import type { Row } from './Wizard'

interface Props { row: Row | null }

export default function PreviewPane({ row }: Props) {
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
      display: 'flex', flexDirection: 'column', maxHeight: 520, overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>
        预览
      </div>

      {!row ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', padding: 40 }}>
          在左侧选择一个文件
        </div>
      ) : !row.extract ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', padding: 40, flexDirection: 'column', gap: 12 }}>
          {row.phase === 'parsing' ? (
            <>
              <div style={{ fontSize: 30 }}>⏳</div>
              <div>解析中…</div>
            </>
          ) : row.phase === 'failed' ? (
            <>
              <div style={{ fontSize: 30, color: '#dc2626' }}>✗</div>
              <div style={{ color: '#dc2626', maxWidth: 300, textAlign: 'center' }}>{row.error ?? '解析失败'}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 30 }}>📄</div>
              <div>点底部"解析全部"开始</div>
            </>
          )}
        </div>
      ) : row.extract.kind === 'attachment' ? (
        <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
          <div style={{
            padding: 16, background: '#fff7e6', border: '1px solid #ffd591',
            borderRadius: 8, fontSize: 13, color: '#874d00',
          }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📎</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>附件入库模式</div>
            <div style={{ lineHeight: 1.6 }}>{row.extract.hint}</div>
            <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280' }}>
              此类格式文本抽取受限。将以附件形式提交 BookStack，内容不进向量索引。
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
            {row.extract.text.length.toLocaleString()} 字符
            {row.extract.summary && ' · 含自动摘要'}
          </div>
          {row.extract.summary && (
            <div style={{
              padding: 10, background: '#f0f9ff', border: '1px solid #bae6fd',
              borderRadius: 6, fontSize: 12, color: '#0369a1', marginBottom: 12,
              fontStyle: 'italic',
            }}>
              <strong>摘要：</strong> {row.extract.summary}
            </div>
          )}
          <pre style={{
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontSize: 12, lineHeight: 1.6, margin: 0,
            fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--text)',
          }}>
            {row.extract.text.length > 4000
              ? row.extract.text.slice(0, 4000) + '\n\n…（截断，已读取 ' + row.extract.text.length + ' 字符）'
              : row.extract.text}
          </pre>
        </div>
      )}
    </div>
  )
}
