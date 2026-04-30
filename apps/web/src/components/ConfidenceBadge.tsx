/**
 * ConfidenceBadge —— 引用文档相关性分数 pill
 *
 * rag-relevance-hygiene · A-FE-1
 *
 * 分四档，保持和后端 services/relevanceFormat.ts 的 bucket 一致：
 *   ≥ 0.5    high    绿色  "高相关"
 *   ≥ 0.1    medium  蓝色  "中相关"
 *   ≥ 0.01   weak    灰色  "弱相关"
 *   else     none    红色  "几无相关"
 *
 * tooltip 始终展示原始分数（科学记数或三位小数，视量级）。
 */

import { useTranslation } from 'react-i18next'

interface Props {
  score: number | null | undefined
}

type Bucket = 'high' | 'medium' | 'weak' | 'none'

function bucket(s: number | null | undefined): Bucket {
  if (s == null || !Number.isFinite(s as number)) return 'none'
  const n = Number(s)
  if (n >= 0.5)  return 'high'
  if (n >= 0.1)  return 'medium'
  if (n >= 0.01) return 'weak'
  return 'none'
}

function formatRaw(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s as number)) return '—'
  const n = Number(s)
  if (n >= 0.5)  return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(3)
  return n.toExponential(2)
}

const STYLES: Record<Bucket, { bg: string; fg: string }> = {
  high:   { bg: '#D1FAE5', fg: '#065F46' },
  medium: { bg: '#DBEAFE', fg: '#1D4ED8' },
  weak:   { bg: '#F3F4F6', fg: '#6B7280' },
  none:   { bg: '#FEE2E2', fg: '#991B1B' },
}

export default function ConfidenceBadge({ score }: Props) {
  const { t } = useTranslation('components')
  const b = bucket(score)
  const s = STYLES[b]
  const raw = formatRaw(score)
  return (
    <span
      className="tag"
      title={t('confidence.tooltip', { score: raw })}
      style={{
        background: s.bg,
        color: s.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {t(`confidence.${b}`)} · {raw}
    </span>
  )
}
