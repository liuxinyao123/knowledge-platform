/**
 * PreprocessingModule —— /ingest 与 /ingest/jobs/:id 共享的"数据预处理模块"
 *
 * 渲染：
 *   - 头部：当前文件 + PDF/Word/Excel/Markdown/OCR 标签 + 「规则配置」入口
 *   - 6 步 pipeline 横向 stepper
 *   - 「正在 X」浅紫 panel（active 时；带策略 / 已生成 / 平均 token）
 *   - 表格提取预览
 *   - 完成 / 失败 banner（仅 detail 页显示）
 *   - 运行日志（仅 detail 页显示）
 *
 * 复用模式：
 *   - `<PreprocessingModule jobId={id} variant="full" />`     —— /ingest/jobs/:id 详情页
 *   - `<PreprocessingModule jobId={id} variant="embedded" />` —— /ingest 主页嵌入；
 *                                                               隐藏日志/banner，标题区可点跳转详情
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getJob, streamJob, type JobDetail, type JobStep } from '@/api/ingest'
import { getPgAssetDetail, type PgAssetDetail } from '@/api/assetDirectory'
import MarkdownView from '@/components/MarkdownView'

// ingest-async-pipeline Phase E（2026-04-25）：SSE + 轮询双保险
//   - 优先 SSE：phase 切换毫秒级触发刷新
//   - 轮询作 safety net（SSE 失败 / 中断时仍能更新）；间隔从 1.5s 拉到 5s 减少负载
//   - SSE 不可用环境（jsdom 测试 / 老浏览器）自动回退到纯轮询，行为字节级等同旧版
const POLL_MS = 5000
const HAS_EVENT_SOURCE = typeof EventSource === 'function'

const FILE_TYPE_TAGS = ['PDF', 'Word', 'Excel', 'Markdown', 'OCR']

function fileTypeFromName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'PDF'
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return 'Word'
  if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) return 'Excel'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'Markdown'
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'OCR'
  if (lower.startsWith('http')) return 'Web'
  return 'Other'
}

const STRATEGY_LABEL: Record<string, string> = {
  heading: '按标题/段落',
  fixed:   '固定长度',
  smart:   '智能切分',
}

interface Props {
  /** undefined 时渲染空态（"暂无任务"） */
  jobId: string | undefined
  /** full = 详情页（带日志、banner、返回按钮）；embedded = 主页嵌入（紧凑） */
  variant: 'full' | 'embedded'
}

export default function PreprocessingModule({ jobId, variant }: Props) {
  const [data, setData] = useState<{ job: JobDetail; steps: JobStep[] } | null>(null)
  const [assetDetail, setAssetDetail] = useState<PgAssetDetail | null>(null)
  const [assetLoading, setAssetLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    if (!jobId) { setData(null); return }
    try {
      const d = await getJob(jobId)
      setData(d); setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }, [jobId])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!jobId || !data) return
    const isFinal = data.job.phase === 'done' || data.job.phase === 'failed'
    if (isFinal) return

    // 1) 慢轮询 safety net —— 不论 SSE 成败都跑（5s 间隔，对老 case / SSE 中断兜底）
    const pollTimer = setInterval(() => { void refresh() }, POLL_MS)

    // 2) 快路径 SSE —— phase 切换 / 完成立即触发 refresh()
    let stopStream: (() => void) | null = null
    if (HAS_EVENT_SOURCE) {
      try {
        stopStream = streamJob(jobId, {
          onPhase: () => { void refresh() },
          onDone:  () => { void refresh() },
          onError: () => {
            // SSE 连接失败 / 中断：什么都不做，pollTimer 继续兜底
          },
        })
      } catch {
        // streamJob 可能抛（test 环境 mock 缺失等）；轮询路径不受影响
        stopStream = null
      }
    }

    return () => {
      clearInterval(pollTimer)
      if (stopStream) stopStream()
    }
  }, [jobId, data, refresh])

  // 任务完成 + 有 assetId 时，拉资产详情用于"提取内容预览"
  useEffect(() => {
    const assetId = data?.job.assetId
    if (!assetId || data.job.phase !== 'done') { setAssetDetail(null); return }
    setAssetLoading(true)
    getPgAssetDetail(assetId)
      .then((d) => { setAssetDetail(d); setAssetLoading(false) })
      .catch(() => { setAssetDetail(null); setAssetLoading(false) })
  }, [data?.job.assetId, data?.job.phase])

  const extractedMarkdown = useMemo(() => {
    if (!assetDetail) return ''
    return assembleAssetMarkdown(assetDetail)
  }, [assetDetail])

  // ── 空态 ────────────────────────────────────────────────────────────────
  if (!jobId) {
    return (
      <div style={panelStyle} data-testid="preprocessing-empty">
        <Header title="数据预处理模块" right={<TypeTags active={null} />} />
        <div style={{
          padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13,
        }}>
          暂无任务 · 提交一个文件 / 网页 / 对话后，预处理流水线会在这里实时展示
        </div>
      </div>
    )
  }

  if (err) {
    return (
      <div style={panelStyle}>
        <Header title="数据预处理模块" />
        <div style={{ padding: 20, color: '#b91c1c', fontSize: 13 }}>{err}</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div style={panelStyle}>
        <Header title="数据预处理模块" />
        <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>加载中…</div>
      </div>
    )
  }

  const { job, steps } = data
  const fileType = fileTypeFromName(job.name)
  const activeStep = steps.find((s) => s.status === 'active')
  const compact = variant === 'embedded'

  return (
    <div style={panelStyle} data-testid={`preprocessing-${variant}`}>
      {/* Header：当前文件 + 类型标签 */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 10,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            数据预处理模块
          </div>
          {compact ? (
            <button
              type="button"
              onClick={() => navigate(`/ingest/jobs/${job.id}`)}
              style={{
                background: 'transparent', border: 'none', padding: 0,
                fontSize: 12, color: 'var(--muted)', cursor: 'pointer', marginTop: 2,
              }}
              title="点击查看详情"
            >
              当前文件：<span style={{ color: 'var(--text)' }}>{job.name}</span> →
            </button>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              当前文件：{job.name}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <TypeTags active={fileType} />
          <button
            type="button"
            className="btn"
            onClick={() => navigate('/iam')}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            规则配置
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div style={{ padding: '20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          {steps.map((s, i) => (
            <Step
              key={s.id}
              label={s.label}
              detail={stepDetail(s, job)}
              status={s.status}
              isLast={i === steps.length - 1}
            />
          ))}
        </div>
      </div>

      {/* "正在 X" 浅色 panel */}
      {activeStep && (
        <div style={{
          background: 'rgba(108,71,255,0.06)', margin: '0 16px 16px',
          borderRadius: 8, padding: '14px 18px',
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16,
        }}>
          <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>
            ⚡ 正在{activeStep.label}
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>
              {activeStep.id === 'chunk' ? '已生成切片' : '阶段进度'}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>
              {job.preview.chunks
                ? `${job.preview.chunks.generated} / ${job.preview.chunks.total} 片`
                : `${Math.round(job.progress)}%`}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>
              {activeStep.id === 'chunk' ? '平均片段长度' : '策略'}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>
              {job.preview.chunks?.avgTokens ? `${job.preview.chunks.avgTokens} tokens`
                : STRATEGY_LABEL[job.strategy] ?? job.strategy}
            </div>
          </div>
        </div>
      )}

      {/* 表格提取预览 */}
      {(job.preview.tables?.length ?? 0) > 0 && (
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
            表格提取预览
          </div>
          {job.preview.tables!.map((t, i) => (
            <table key={i} className="table" style={{
              width: '100%', borderCollapse: 'collapse', marginBottom: 12,
            }}>
              <thead>
                <tr>
                  {(t.rows[0] ?? []).map((cell, j) => (
                    <th key={j} style={cellStyle(true)}>{cell}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.slice(1).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={cellStyle(false)}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}

      {/* 提取内容预览 —— 任务 done + 有 assetId 时拉资产并按 markdown 渲染 */}
      {job.phase === 'done' && job.assetId != null && (
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            marginBottom: 8,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              提取内容预览
            </div>
            {assetDetail && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                显示前 {assetDetail.chunks.samples.length} / 共 {assetDetail.chunks.total} 段
                {assetDetail.images.length > 0 && ` · ${assetDetail.images.length} 张图`}
              </span>
            )}
          </div>
          <div style={{
            border: '1px solid var(--border)', borderRadius: 8, background: '#fff',
            padding: '14px 18px',
            maxHeight: compact ? 360 : 600,
            overflowY: 'auto',
          }}>
            {assetLoading && (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>加载中…</div>
            )}
            {!assetLoading && extractedMarkdown.trim().length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                此资产暂无切片内容（embedding 未配置时常见）
              </div>
            )}
            {extractedMarkdown.trim().length > 0 && (
              <MarkdownView source={extractedMarkdown} />
            )}
          </div>
          {compact && extractedMarkdown.trim().length > 0 && (
            <div style={{
              marginTop: 6, fontSize: 11, color: 'var(--muted)', textAlign: 'right',
            }}>
              滚动查看更多 · 完整阅读视图见
              <button
                type="button"
                onClick={() => navigate(`/spaces`)}
                style={{
                  background: 'transparent', border: 'none', padding: '0 4px',
                  color: 'var(--p, #6C47FF)', fontSize: 11, cursor: 'pointer',
                }}
              >/spaces →</button>
            </div>
          )}
        </div>
      )}

      {/* 完成 / 失败 banner —— 仅 full 页面 */}
      {!compact && job.phase === 'done' && (
        <div style={{
          margin: '0 16px 16px', background: '#dbeafe', color: '#1e40af',
          borderRadius: 8, padding: '12px 16px', fontSize: 13,
        }}>
          ✅ 已完成 · asset_id={job.assetId ?? '—'} · chunks={job.chunkCount ?? 0}
          {job.preview.tags?.length ? ` · tags=${job.preview.tags.join(', ')}` : ''}
        </div>
      )}
      {!compact && job.phase === 'failed' && (
        <div style={{
          margin: '0 16px 16px', background: '#fee2e2', color: '#b91c1c',
          borderRadius: 8, padding: '12px 16px', fontSize: 13,
        }}>
          ❌ 失败：{job.error ?? 'unknown'}
        </div>
      )}

      {/* 紧凑模式：尾部状态条 */}
      {compact && (
        <div style={{
          padding: '10px 16px', borderTop: '1px solid var(--border)',
          fontSize: 12, color: 'var(--muted)',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>
            阶段：{job.phase} · 进度 {Math.round(job.progress)}%
            {job.assetId != null && ` · asset_id=${job.assetId}`}
          </span>
          <button
            type="button"
            onClick={() => navigate(`/ingest/jobs/${job.id}`)}
            style={{
              background: 'transparent', border: 'none', color: 'var(--p, #6C47FF)',
              fontSize: 12, cursor: 'pointer', padding: 0,
            }}
          >
            查看完整日志 →
          </button>
        </div>
      )}

      {/* 运行日志 —— 仅 full */}
      {!compact && (
        <div style={{
          padding: 16, borderTop: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
            运行日志
          </div>
          <div style={{
            maxHeight: 280, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12,
          }}>
            {job.log.length === 0 ? (
              <div style={{ color: 'var(--muted)' }}>暂无日志</div>
            ) : (
              job.log.map((l, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', gap: 8, padding: '4px 0',
                    borderBottom: '1px dashed #f3f4f6',
                  }}
                >
                  <span style={{ color: 'var(--muted)', width: 90 }}>
                    {new Date(l.at).toLocaleTimeString()}
                  </span>
                  <span style={{
                    color: l.level === 'error' ? '#b91c1c' : l.level === 'warn' ? '#92400e' : '#047857',
                    width: 60, fontWeight: 500,
                  }}>{l.phase}</span>
                  <span style={{ color: 'var(--text)', flex: 1 }}>{l.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 内部组件 ────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
  marginTop: 14, overflow: 'hidden',
}

function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{
      padding: '14px 16px', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {right}
    </div>
  )
}

function TypeTags({ active }: { active: string | null }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {FILE_TYPE_TAGS.map((t) => (
        <span
          key={t}
          style={{
            padding: '3px 10px', borderRadius: 999, fontSize: 11,
            background: t === active ? 'var(--p, #6C47FF)' : '#f3f4f6',
            color:      t === active ? '#fff' : 'var(--muted)',
          }}
        >{t}</span>
      ))}
    </div>
  )
}

function stepDetail(s: JobStep, job: JobDetail): string {
  if (s.id === 'parse') return job.kind === 'fetch-url' ? '网页 → 文本' : '文件 → 文本'
  if (s.id === 'ocr') return job.preview.images ? `图片页 × ${job.preview.images}` : ''
  if (s.id === 'table') return job.preview.tables?.length ? `表格 × ${job.preview.tables.length}` : ''
  if (s.id === 'chunk') {
    const ck = job.preview.chunks
    if (ck) return `${STRATEGY_LABEL[job.strategy] ?? job.strategy} · ${Math.round((ck.generated / Math.max(1, ck.total)) * 100)}%`
    return STRATEGY_LABEL[job.strategy] ?? job.strategy
  }
  if (s.id === 'tag') return job.preview.tags?.length ? `${job.preview.tags.length} 标签` : '等待中'
  if (s.id === 'embed') return job.vectorize ? `${job.chunkCount ?? 0} chunks` : '已禁用'
  return ''
}

function Step({
  label, detail, status, isLast,
}: { label: string; detail: string; status: JobStep['status']; isLast: boolean }) {
  const tone = status === 'done' ? { bg: '#10b981', icon: '✓' }
    : status === 'active' ? { bg: 'var(--p, #6C47FF)', icon: '⚡' }
    : status === 'failed' ? { bg: '#ef4444', icon: '✕' }
    : { bg: '#e5e7eb', icon: '○' }

  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: isLast ? 'none' : 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 90 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: status === 'pending' ? '#f3f4f6' : tone.bg,
          color: status === 'pending' ? 'var(--muted)' : '#fff',
          fontSize: 14, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{tone.icon}</div>
        <span style={{
          fontSize: 12, marginTop: 6,
          color: status === 'active' ? 'var(--p, #6C47FF)' : status === 'done' ? '#10b981' : 'var(--muted)',
          fontWeight: status === 'active' ? 600 : 500,
        }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          {detail || (status === 'pending' ? '等待中' : '')}
        </span>
      </div>
      {!isLast && (
        <div style={{
          flex: 1, height: 2, margin: '0 8px', marginBottom: 28,
          background: status === 'done' ? '#10b981' : '#e5e7eb',
        }} />
      )}
    </div>
  )
}

function cellStyle(header: boolean): React.CSSProperties {
  return {
    padding: '8px 12px', textAlign: 'left',
    fontSize: 12, color: header ? 'var(--muted)' : 'var(--text)',
    borderBottom: '1px solid #f3f4f6',
    background: header ? '#f9fafb' : 'transparent',
    fontWeight: header ? 600 : 400,
  }
}

// ── assemble extracted asset markdown（与 SpaceTree/PreviewPane 同款，按 page 排序，插图）
function assembleAssetMarkdown(d: PgAssetDetail): string {
  type Item =
    | { kind: 'heading'; page: number; text: string; level: number; sortKey: number }
    | { kind: 'sample';  page: number; text: string; sortKey: number }
    | { kind: 'image';   page: number; id: number; caption: string; sortKey: number }

  const items: Item[] = []
  for (const h of d.chunks.headings) {
    items.push({
      kind: 'heading', page: h.page, text: h.text,
      level: inferHeadingLevelFromPath(h.heading_path),
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
      const alt = it.caption || `图 p.${it.page}`
      out.push(`![${alt.replace(/[\[\]()]/g, '')}](/api/asset-directory/asset-images/${it.id})`)
    }
    out.push('')
    lastPage = it.page
  }
  return out.join('\n')
}

function inferHeadingLevelFromPath(headingPath: string | null): number {
  if (!headingPath) return 2
  const segs = headingPath.split('/').map((s) => s.trim()).filter(Boolean)
  return Math.min(6, Math.max(1, segs.length + 1))
}
