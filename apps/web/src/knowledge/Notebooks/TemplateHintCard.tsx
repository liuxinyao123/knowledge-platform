/**
 * TemplateHintCard —— Notebook Detail 顶部的模板推荐提示卡（N-006 / N-007）
 *
 * 当 notebook.template_id 存在 + localStorage 没 dismiss 标记时显示。
 * 内容：模板 label / icon / desc / recommendedSourceHint /
 *      推荐 artifact 按钮（点击触发 generateArtifact）/
 *      starter questions 芯片（点击预填到 ChatPanel input）/
 *      关闭按钮（dismiss → localStorage 记忆，永久不再显示）
 *
 * 视觉重写（C 工作流，2026-04-29）：
 *   - 配色用产品 design token (var(--p) 主紫 / var(--text) / var(--muted) / var(--border))
 *   - 紧凑 header（emoji + 模板名 + 关闭按钮一行）+ 横向 chip 行
 *   - 推荐 artifact 与起手问题统一 chip 样式：白底 + 紫边 + hover 主紫填充
 *   - 与 NotebookList 卡片视觉同源，避免之前 toast/通知条感
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  listTemplates, type NotebookTemplateSpec,
  type ArtifactKind,
} from '@/api/notebooks'

interface Props {
  notebookId: number
  /** N-007: 模板 key（任意字符串，含 system / community / user） */
  templateId: string
  onTriggerArtifact: (kind: ArtifactKind) => void
  onPickStarter: (question: string) => void
}

function dismissKey(notebookId: number) {
  return `notebook_${notebookId}_template_hint_dismissed`
}

const PRIMARY = 'var(--p, #6C47FF)'
const PRIMARY_TINT = 'rgba(108, 71, 255, 0.06)'   // 8% alpha 主紫，做卡片底
const PRIMARY_BORDER = 'rgba(108, 71, 255, 0.22)' // 22% alpha 主紫，做主边框

export default function TemplateHintCard({
  notebookId, templateId, onTriggerArtifact, onPickStarter,
}: Props) {
  const [spec, setSpec] = useState<NotebookTemplateSpec | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [hoverChip, setHoverChip] = useState<string | null>(null)
  const [hoverClose, setHoverClose] = useState(false)

  useEffect(() => {
    setDismissed(localStorage.getItem(dismissKey(notebookId)) === '1')
  }, [notebookId])

  useEffect(() => {
    let cancel = false
    listTemplates()
      .then((all) => { if (!cancel) setSpec(all.find((t) => t.id === templateId) ?? null) })
      .catch(() => { if (!cancel) setSpec(null) })
    return () => { cancel = true }
  }, [templateId])

  if (dismissed || !spec) return null

  return (
    <div style={cardStyle}>
      {/* Header: emoji + 模板名 + 关闭按钮 */}
      <div style={headerRow}>
        <div style={titleStyle}>
          <span style={iconStyle}>{spec.icon}</span>
          <span>{spec.label} 模板</span>
        </div>
        <button
          type="button"
          title="不再显示这条提示（per-notebook 记忆）"
          aria-label="关闭模板提示"
          onClick={() => {
            localStorage.setItem(dismissKey(notebookId), '1')
            setDismissed(true)
          }}
          onMouseEnter={() => setHoverClose(true)}
          onMouseLeave={() => setHoverClose(false)}
          style={{
            ...closeBtnBase,
            background: hoverClose ? 'rgba(0,0,0,0.05)' : 'transparent',
            color: hoverClose ? 'var(--text)' : 'var(--muted)',
          }}
        >×</button>
      </div>

      {/* 描述 + recommendedSourceHint */}
      <div style={descStyle}>{spec.desc}</div>
      <div style={hintStyle}>
        <span style={{ marginRight: 4 }}>💡</span>
        {spec.recommendedSourceHint}
      </div>

      {/* 推荐生成 + 起手问题 一栏陈列（label + chip 行） */}
      {spec.recommendedArtifactKinds.length > 0 && (
        <div style={sectionStyle}>
          <span style={sectionLabel}>推荐生成</span>
          <div style={chipRow}>
            {spec.recommendedArtifactKinds.map((kind) => {
              const k = `art:${kind}`
              const hov = hoverChip === k
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onTriggerArtifact(kind)}
                  onMouseEnter={() => setHoverChip(k)}
                  onMouseLeave={() => setHoverChip(null)}
                  title={`触发生成 ${kind}（去 Studio 面板看进度）`}
                  style={chipStyle(hov, true)}
                >{kind}</button>
              )
            })}
          </div>
        </div>
      )}

      <div style={sectionStyle}>
        <span style={sectionLabel}>起手提问</span>
        <div style={chipRow}>
          {spec.starterQuestions.map((q, i) => {
            const k = `q:${i}`
            const hov = hoverChip === k
            return (
              <button
                key={i}
                type="button"
                onClick={() => onPickStarter(q)}
                onMouseEnter={() => setHoverChip(k)}
                onMouseLeave={() => setHoverChip(null)}
                title="点击预填到下方输入框"
                style={chipStyle(hov, false)}
              >{q}</button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── styles ──────────────────────────────────────────────────────────────────

const cardStyle: CSSProperties = {
  background: PRIMARY_TINT,
  border: `1px solid ${PRIMARY_BORDER}`,
  borderRadius: 12,
  padding: '14px 16px',
  marginBottom: 12,
  position: 'relative',
}

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 6,
}

const titleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 14,
  fontWeight: 600,
  color: PRIMARY,
  lineHeight: 1.3,
}

const iconStyle: CSSProperties = {
  fontSize: 18,
  lineHeight: 1,
}

const closeBtnBase: CSSProperties = {
  width: 24,
  height: 24,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: 0,
  transition: 'background 120ms, color 120ms',
}

const descStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--text)',
  lineHeight: 1.5,
  marginBottom: 4,
}

const hintStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--muted)',
  lineHeight: 1.4,
  marginBottom: 12,
}

const sectionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  marginTop: 6,
  flexWrap: 'wrap',
}

const sectionLabel: CSSProperties = {
  fontSize: 11,
  color: 'var(--muted)',
  fontWeight: 500,
  paddingTop: 6,
  flexShrink: 0,
  minWidth: 52,
}

const chipRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  flex: 1,
}

function chipStyle(hover: boolean, isArtifact: boolean): CSSProperties {
  return {
    fontSize: 12,
    padding: isArtifact ? '4px 12px' : '5px 12px',
    background: hover ? PRIMARY : '#fff',
    border: `1px solid ${hover ? PRIMARY : PRIMARY_BORDER}`,
    borderRadius: 999,
    color: hover ? '#fff' : PRIMARY,
    cursor: 'pointer',
    fontWeight: isArtifact ? 500 : 400,
    transition: 'background 120ms, color 120ms, border-color 120ms',
    lineHeight: 1.3,
    textAlign: 'left',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }
}
