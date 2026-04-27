/**
 * AnswerContent —— ADR-45 · 答案气泡内嵌图片渲染
 *
 * 把 LLM 输出的纯文本切成 (text | image) 段：
 *   "7° [1] ![diagram](/api/assets/images/42)"
 *     → ["7° [1] ", <img src="/api/assets/images/42" />]
 *
 * 安全：URL 严格只放 `^/api/assets/images/\d+$`。
 *   外部 URL / data: / javascript: / 任何非数字 id 一律退化成 raw text，
 *   防 LLM 幻觉 + XSS。
 *
 * 流式兼容：partial markdown（如 `![](/api/assets/images/42` 还没收到 `)`）
 *   regex 不会匹配，自然走 raw text；后续 token 到齐再 re-render 转图。
 *
 * 仅供 ADR-45 inline image 路径用；其它地方继续走 MarkdownView 或纯文本。
 */
import { Fragment } from 'react'

interface Props {
  content: string
}

/** 严格 allow-list：本仓库的 asset 图字节路由 */
const SAFE_IMAGE_URL_RE = /^\/api\/assets\/images\/\d+$/

/** 抓 markdown ![alt](url)；alt 允许空 / 任意非 ] 字符；url 用尽量贪婪到 ) */
const IMG_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)/g

interface Segment {
  kind: 'text' | 'img'
  text?: string
  alt?: string
  url?: string
}

/** 导出供单测断言 */
export function parseAnswerSegments(content: string): Segment[] {
  if (!content) return []
  const out: Segment[] = []
  let lastIndex = 0
  let m: RegExpExecArray | null

  // reset state on every call（regex 是 module-level，要 reset lastIndex）
  IMG_PATTERN.lastIndex = 0

  while ((m = IMG_PATTERN.exec(content)) !== null) {
    const [match, alt, url] = m
    const start = m.index
    // 段间纯文本
    if (start > lastIndex) {
      out.push({ kind: 'text', text: content.slice(lastIndex, start) })
    }
    // URL 严格校验：不通过的退化为原 markdown 字面文本
    if (SAFE_IMAGE_URL_RE.test(url)) {
      out.push({ kind: 'img', alt, url })
    } else {
      out.push({ kind: 'text', text: match })
    }
    lastIndex = start + match.length
  }
  if (lastIndex < content.length) {
    out.push({ kind: 'text', text: content.slice(lastIndex) })
  }

  // 合并相邻 text 段——譬如 URL 校验失败退化时 `![](js:alert(1))` 会被
  // 拆成 `![](js:alert(1)` (退化 text) + `)` (剩余 text) 两段，合成一段更直观。
  const merged: Segment[] = []
  for (const s of out) {
    const last = merged[merged.length - 1]
    if (s.kind === 'text' && last && last.kind === 'text') {
      last.text = (last.text ?? '') + (s.text ?? '')
    } else {
      merged.push(s)
    }
  }
  return merged
}

export default function AnswerContent({ content }: Props) {
  const segments = parseAnswerSegments(content)

  return (
    <div
      data-testid="answer-content"
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7 }}
    >
      {segments.map((s, i) => {
        if (s.kind === 'img') {
          return (
            <Fragment key={i}>
              <img
                src={s.url}
                alt={s.alt || '答案附图'}
                data-testid="answer-inline-image"
                style={{
                  display: 'block',
                  maxWidth: '100%',
                  maxHeight: 360,
                  margin: '8px 0',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  cursor: 'zoom-in',
                  objectFit: 'contain',
                }}
                loading="lazy"
                onError={(e) => {
                  // 图加载失败兜底：替换为提示文字（防 LLM 偶发输出已删除/无效 image_id）
                  const span = document.createElement('span')
                  span.textContent = `[图片加载失败: ${s.url}]`
                  span.style.color = 'var(--muted)'
                  span.style.fontSize = '12px'
                  e.currentTarget.replaceWith(span)
                }}
                onClick={(e) => {
                  // 简易 zoom：点击在新 tab 打开原图
                  if (s.url) window.open(s.url, '_blank', 'noopener,noreferrer')
                  e.preventDefault()
                }}
              />
            </Fragment>
          )
        }
        // text
        return <Fragment key={i}>{s.text}</Fragment>
      })}
    </div>
  )
}

/** 导出 regex 给单测，避免 magic number */
export const SAFE_IMAGE_URL_PATTERN_FOR_TEST = SAFE_IMAGE_URL_RE
