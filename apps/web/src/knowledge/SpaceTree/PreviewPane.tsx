/**
 * PreviewPane —— 资产阅读视图（PG metadata_asset）
 *
 * 设计目标：像读文档，不像看数据库 dump。
 * 所以：
 *   - 顶部 meta 卡（数据源/类型/切片数/标签）保留，但折叠成一行
 *   - 中段：把 chunks (samples + headings) 按 chunk_index 顺序拼成一份 markdown
 *           走 MarkdownView 渲染（## 标题、**粗体**、`code` 等都正常）
 *           HTML entity (&lt; &gt; &amp; ...) 自动解码
 *   - 底部：「显示前 N / 共 X 段 · 完整资产 →」
 *
 * 历史问题（已修）：
 *   - 之前每段 chunk 渲染成独立小框，导致整页像零碎卡片
 *   - 之前没 parse markdown，## **bold** &gt; 等都以裸字符显示
 */
import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPgAssetDetail, type PgAssetDetail } from '@/api/assetDirectory'
import MarkdownView from '@/components/MarkdownView'
import type { SelectedAsset } from './types'

interface Props {
  asset: SelectedAsset | null
}

export default function PreviewPane({ asset }: Props) {
  const navigate = useNavigate()
  const [detail, setDetail] = useState<PgAssetDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!asset) { setDetail(null); setErr(null); return }
    setLoading(true); setErr(null); setDetail(null)
    getPgAssetDetail(asset.id)
      .then((d) => { setDetail(d); setLoading(false) })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : '加载失败')
        setLoading(false)
      })
  }, [asset?.id])

  // 把 headings + samples 按 chunk 的概念拼成 markdown
  // headings 是 chunk_level=1（标题），samples 是 chunk_level=3 前 10 段（正文）
  // 目标：模拟原文阅读感
  const combinedMarkdown = useMemo(() => {
    if (!detail) return ''
    return assembleMarkdown(detail)
  }, [detail])

  if (!asset) {
    return (
      <div style={emptyStyle}>
        <span style={{ fontSize: 32, marginBottom: 8 }}>📄</span>
        <span style={{ color: 'var(--muted)' }}>从左侧选择一个资产预览</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid var(--border)',
        flexShrink: 0, gap: 12,
      }}>
        <span style={{
          fontWeight: 700, fontSize: 14, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {detail?.asset.name ?? asset.name}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {detail?.asset.indexed_at && (
            <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {new Date(detail.asset.indexed_at).toLocaleDateString('zh-CN')}
            </span>
          )}
          {detail?.asset.path && (
            <a
              href={detail.asset.path}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12, color: 'var(--p, #6C47FF)', textDecoration: 'none',
                padding: '3px 10px', border: '1px solid var(--border)',
                borderRadius: 6, whiteSpace: 'nowrap',
              }}
            >
              ↗ 打开原文
            </a>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {loading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>加载中…</div>}
        {err && <div style={{ color: '#b91c1c', fontSize: 13 }}>加载失败：{err}</div>}

        {detail && (
          <>
            <CompactMetaBar detail={detail} fallback={asset} />

            {combinedMarkdown.trim().length === 0 ? (
              <div style={{
                padding: '40px 0', textAlign: 'center',
                color: 'var(--muted)', fontSize: 13,
              }}>
                此资产暂无切片内容（待索引或入库失败）
              </div>
            ) : (
              <MarkdownView source={combinedMarkdown} />
            )}

            <div style={{
              marginTop: 24, paddingTop: 12, borderTop: '1px dashed var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 12, color: 'var(--muted)',
            }}>
              <span>
                显示前 {detail.chunks.samples.length} / 共 {detail.chunks.total} 段
                {detail.images.length > 0 && ` · ${detail.images.length} 张图`}
              </span>
              <button
                type="button"
                onClick={() => navigate(`/assets/${detail.asset.id}`)}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--p, #6C47FF)', fontSize: 12, cursor: 'pointer', padding: 0,
                }}
              >
                完整资产详情 →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── 压缩成一行的 meta bar（数据源 · 类型 · 切片数 · 标签） ──────────────────

function CompactMetaBar({
  detail, fallback,
}: { detail: PgAssetDetail; fallback: SelectedAsset }) {
  const tags = detail.asset.tags?.length ? detail.asset.tags : (fallback.tags ?? [])
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
      padding: '8px 12px', marginBottom: 16,
      background: '#fafafa', border: '1px solid var(--border)', borderRadius: 8,
      fontSize: 12,
    }}>
      <Pill label="数据源" value={detail.source.name ?? fallback.sourceName} />
      {detail.source.connector && (
        <span style={connectorStyle}>{detail.source.connector}</span>
      )}
      <Pill label="类型" value={detail.asset.type} />
      <Pill label="切片" value={`${detail.chunks.total}`} />
      {detail.images.length > 0 && <Pill label="图片" value={`${detail.images.length}`} />}
      {tags.length > 0 && (
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginLeft: 4 }}>
          {tags.map((t) => (
            <span key={t} style={{
              padding: '1px 8px', borderRadius: 999,
              background: 'rgba(108,71,255,0.08)',
              color: 'var(--p, #6C47FF)', fontSize: 11,
            }}>{t}</span>
          ))}
        </span>
      )}
    </div>
  )
}

function Pill({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span>
      <span style={{ color: 'var(--muted)' }}>{label}：</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </span>
  )
}

const connectorStyle: React.CSSProperties = {
  padding: '1px 6px', borderRadius: 999,
  background: '#f3f4f6', color: 'var(--muted)', fontSize: 10,
}

// ── 把后端返的 chunks + images 拼成一份 markdown ────────────────────────────
//
// 策略：
//   - 收集 headings + samples + images 全部，每条带 page
//   - 按 page 排序；page 内顺序：headings → samples → images
//   - heading 强制 ## 前缀
//   - image 用 ![caption](/api/asset-directory/asset-images/:id) 注入
//   - 跨页加 hr + 灰色 page 标记
function assembleMarkdown(d: PgAssetDetail): string {
  type Item =
    | { kind: 'heading'; page: number; text: string; level: number; sortKey: number }
    | { kind: 'sample';  page: number; text: string; sortKey: number }
    | { kind: 'image';   page: number; id: number; caption: string; sortKey: number }

  const items: Item[] = []
  for (const h of d.chunks.headings) {
    items.push({
      kind: 'heading', page: h.page, text: h.text,
      level: inferHeadingLevel(h.heading_path),
      sortKey: 0,
    })
  }
  for (const s of d.chunks.samples) {
    items.push({ kind: 'sample', page: s.page, text: s.text, sortKey: 1 })
  }
  for (const img of d.images) {
    items.push({
      kind: 'image', page: img.page, id: img.id,
      caption: (img.caption ?? '').trim(),
      sortKey: 2,
    })
  }

  items.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey
    if (a.kind === 'heading' && b.kind === 'heading') return a.level - b.level
    return 0
  })

  const out: string[] = []
  let lastPage = -1
  for (const it of items) {
    if (it.page > 0 && it.page !== lastPage && lastPage !== -1) {
      out.push('---')
      out.push(`> *p.${it.page}*`)
    }
    if (it.kind === 'heading') {
      const level = Math.min(6, Math.max(1, it.level))
      const stripped = it.text.replace(/^#+\s*/, '').trim()
      out.push('#'.repeat(level) + ' ' + stripped)
    } else if (it.kind === 'sample') {
      out.push(it.text.trim())
    } else {
      // image：caption 当 alt；没 caption 退化为 "图 p.N #idx"
      const alt = it.caption || `图 p.${it.page}`
      out.push(`![${alt.replace(/[\[\]()]/g, '')}](/api/asset-directory/asset-images/${it.id})`)
    }
    out.push('')
    lastPage = it.page
  }
  return out.join('\n')
}

function inferHeadingLevel(headingPath: string | null): number {
  if (!headingPath) return 2
  // headingPath 可能是 "1.0", "1.0 / 1.1"；以 / 数量推断深度
  const segs = headingPath.split('/').map((s) => s.trim()).filter(Boolean)
  return Math.min(6, Math.max(1, segs.length + 1))
}

const emptyStyle: React.CSSProperties = {
  height: '100%', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  color: 'var(--muted)', fontSize: 13,
}
