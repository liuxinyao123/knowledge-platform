/**
 * /search —— 统一检索
 * 对齐原型 §page-knowledge-search：
 *  - page-body / page-title / page-sub + 右侧动作按钮
 *  - KnowledgeTabs
 *  - search-hero（大搜索框 + pill 筛选）
 *  - split 两栏：左 panel 结果列表 / 右 panel 预览
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import { bsApi } from '@/api/bookstack'
import type { BSSearchResult } from '@/types/bookstack'
import { useDebounce } from '@/hooks/useDebounce'

type TypeFilter = '全部空间' | '文档' | '会议纪要' | 'FAQ' | '网页'

const TYPE_FILTER_MAP: Record<TypeFilter, BSSearchResult['type'][]> = {
  全部空间: ['bookshelf', 'book', 'chapter', 'page'],
  文档:     ['page'],
  会议纪要:  ['chapter'],
  FAQ:      ['book'],
  网页:     ['bookshelf'],
}

const TYPE_LABEL: Record<BSSearchResult['type'], string> = {
  bookshelf: '书架',
  book: '图书',
  chapter: '章节',
  page: '页面',
}

const TYPE_ICON: Record<BSSearchResult['type'], string> = {
  bookshelf: '🗂',
  book: '📘',
  chapter: '📑',
  page: '📄',
}

/** 把 BookStack 返的 <strong>…</strong> 换成原型风格 .hl 高亮 */
function highlight(html: string): string {
  return html.replace(/<strong>(.*?)<\/strong>/gi, '<span class="hl">$1</span>')
}

/**
 * BUG-02：某些文档的 body 是一团入库期抛出的 error JSON（文件路径 + 错误码），
 * 索引把它当正文存下来，搜索时直接泄漏给用户。前端做一道防御性拦截，
 * 识别出"JSON error blob"就替换成不可预览提示。
 *
 * 根治需要 ingest 阶段过滤"顶层带 error 的 JSON body"；本修复只管 UI 暴露面。
 */
function sanitizePreview(html: string): string {
  const stripped = html.replace(/<[^>]+>/g, '').trim()
  if (!stripped) return html

  // 快速特征：JSON + 顶层有 error / not_found_error / File not found in container
  const looksLikeErrorJson = stripped.startsWith('{') && (
    /"type"\s*:\s*"error"/.test(stripped) ||
    /"error"\s*:\s*\{/.test(stripped) ||
    /not_found_error/.test(stripped) ||
    /File not found in container/.test(stripped)
  )
  if (looksLikeErrorJson) return '<em style="color:var(--muted)">（此文档因入库异常暂不可预览）</em>'
  return html
}

export default function Search() {
  const navigate = useNavigate()
  // BUG-09 支撑：从 URL ?q= 读初始 query（侧栏搜索框跳过来时会传）
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('全部空间')
  const [allResults, setAllResults] = useState<BSSearchResult[]>([])
  const [selected, setSelected] = useState<BSSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [isFavorited, setIsFavorited] = useState(false)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)

  const debouncedQuery = useDebounce(query, 300)

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      if (debouncedQuery.length === 0) {
        setAllResults([])
        setHasSearched(false)
        setSelected(null)
      }
      return
    }
    setLoading(true)
    setHasSearched(true)
    bsApi.search(debouncedQuery, 20)
      .then((res) => {
        setAllResults(res.data)
        setSelected(null)
        setIsFavorited(false)
      })
      .finally(() => setLoading(false))
  }, [debouncedQuery])

  const filteredResults = typeFilter === '全部空间'
    ? allResults
    : allResults.filter((r) => TYPE_FILTER_MAP[typeFilter].includes(r.type))

  function handleSelect(r: BSSearchResult) {
    setSelected(r)
    const favs: { id: number; name: string; url: string }[] = JSON.parse(
      localStorage.getItem('kc_favorites') ?? '[]',
    )
    setIsFavorited(favs.some((f) => f.id === r.id))
  }

  function handleFavorite() {
    if (!selected) return
    const favs: { id: number; name: string; url: string }[] = JSON.parse(
      localStorage.getItem('kc_favorites') ?? '[]',
    )
    if (!favs.some((f) => f.id === selected.id)) {
      favs.push({ id: selected.id, name: selected.name, url: selected.url })
      localStorage.setItem('kc_favorites', JSON.stringify(favs))
      setIsFavorited(true)
    }
  }

  function handleCopyRef() {
    if (!selected) return
    const ref = `${selected.name} — ${selected.url}`
    navigator.clipboard?.writeText(ref)
      .then(() => setCopyMsg('已复制引用'))
      .catch(() => setCopyMsg('复制失败（剪贴板权限？）'))
    setTimeout(() => setCopyMsg(null), 2000)
  }

  const filters: TypeFilter[] = ['全部空间', '文档', '会议纪要', 'FAQ', '网页']

  return (
    <div className="page-body">
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">统一检索</div>
          <div className="page-sub">全文 / 标签 / 作者 / 时间过滤，支持预览命中片段</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/overview')}>返回总览</button>
        </div>
      </div>

      <KnowledgeTabs />

      {/* Search hero */}
      <div className="search-hero">
        <input
          type="search"
          role="searchbox"
          className="field big-search"
          placeholder="搜索：例如「MCP 接入」「增长复盘」「治理指标」"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setTypeFilter(f)}
              className={`pill${typeFilter === f ? ' active' : ''}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Split two-column */}
      <div className="split">
        {/* Left: result list */}
        <div className="surface-card split-left panel">
          <div className="panel-head">
            <div className="title">结果</div>
            {hasSearched && (
              <span className="pill blue" style={{ cursor: 'default' }}>
                {filteredResults.length}
              </span>
            )}
            <div style={{ flex: 1 }} />
          </div>
          <div className="panel-body" data-testid="result-list">
            {/* BUG-08：把 debounce 等待期也纳入 loading，避免用户以为"点回车无反应" */}
            {(() => {
              const isTyping = query.trim().length >= 2 && query !== debouncedQuery
              const showLoading = loading || isTyping
              return (
                <>
                  {!hasSearched && !showLoading && (
                    <div className="empty-state" data-testid="search-prompt">
                      <div className="empty-illus">🔎</div>
                      <div className="empty-text">输入关键词开始搜索</div>
                    </div>
                  )}
                  {showLoading && (
                    <div
                      data-testid="search-loading"
                      style={{ padding: '16px 14px', color: 'var(--muted)', fontSize: 13 }}
                    >
                      搜索中…
                    </div>
                  )}
                  {!showLoading && hasSearched && filteredResults.length === 0 && (
                    <div className="empty-state" data-testid="empty-state">
                      <div className="empty-illus">🔎</div>
                      <div className="empty-text">没有匹配结果。试试更宽泛的关键词或移除筛选条件。</div>
                    </div>
                  )}
                </>
              )
            })()}
            {!loading && filteredResults.map((r) => (
              <div
                key={r.id}
                className={`result-item${selected?.id === r.id ? ' active' : ''}`}
                onClick={() => handleSelect(r)}
              >
                <div className="result-title">
                  <span style={{ marginRight: 6 }}>{TYPE_ICON[r.type]}</span>
                  {r.name}
                </div>
                {r.preview_html.content && (
                  <div
                    className="result-snippet"
                    dangerouslySetInnerHTML={{ __html: sanitizePreview(highlight(r.preview_html.content)) }}
                  />
                )}
                {r.tags.length > 0 && (
                  <div className="tag-row">
                    {r.tags.slice(0, 4).map((t, i) => (
                      <span key={`${t.name}-${i}`} className="tag">{t.value || t.name}</span>
                    ))}
                    <span className="tag">{TYPE_LABEL[r.type]}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: preview */}
        <div className="surface-card split-right panel" data-testid="preview-panel">
          <div className="panel-head">
            <div className="title">预览</div>
            <div style={{ flex: 1 }} />
            {selected && (
              <a
                href={selected.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn"
                style={{ textDecoration: 'none' }}
              >
                ↗ 打开原文
              </a>
            )}
          </div>
          <div className="panel-body" style={{ padding: 14 }}>
            {!selected ? (
              <div className="empty-state">
                <div className="empty-illus">📄</div>
                <div className="empty-text">在左侧选择一个结果以预览</div>
              </div>
            ) : (
              <>
                {/* Title + meta + actions */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 10, flexWrap: 'wrap',
                }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)' }}>
                      {selected.name}
                    </div>
                    <div style={{
                      fontSize: 12, color: 'var(--muted)', marginTop: 6,
                      display: 'flex', gap: 10, flexWrap: 'wrap',
                    }}>
                      <span>类型：{TYPE_LABEL[selected.type]}</span>
                      {selected.book_id && <span>书 #{selected.book_id}</span>}
                      {selected.chapter_id && <span>章 #{selected.chapter_id}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      data-testid="btn-favorite"
                      className={`pill${isFavorited ? ' active' : ''}`}
                      onClick={handleFavorite}
                    >⭐ {isFavorited ? '已收藏' : '收藏'}</button>
                    <button className="pill" onClick={handleCopyRef}>⛓ 复制引用</button>
                  </div>
                </div>

                {copyMsg && (
                  <div style={{
                    marginTop: 10, padding: 6, fontSize: 12,
                    background: 'var(--green-bg)', color: 'var(--green)',
                    borderRadius: 6, textAlign: 'center',
                  }}>{copyMsg}</div>
                )}

                {/* Content preview card */}
                <div style={{
                  marginTop: 12, padding: 12, borderRadius: 12,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  lineHeight: 1.8, color: 'var(--text)', fontSize: 13.5,
                }}>
                  <div
                    dangerouslySetInnerHTML={{ __html: highlight(selected.preview_html.content || '（无内容片段）') }}
                  />
                </div>

                {/* Tags */}
                {selected.tags.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div className="muted-2" style={{ fontWeight: 900, marginBottom: 8 }}>标签</div>
                    <div className="tag-row" style={{ marginTop: 0 }}>
                      {selected.tags.map((t, i) => (
                        <span key={`${t.name}-${i}`} className="tag">
                          {t.name}{t.value ? `: ${t.value}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
