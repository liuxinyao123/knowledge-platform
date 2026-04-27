/**
 * MarkdownView —— 轻量 Markdown 渲染（无外部依赖）
 *
 * 覆盖范围（够用 95% 的资产预览场景）：
 *   - # / ## / ### / ... 标题（最多 6 级）
 *   - **bold** / *italic* / `inline code`
 *   - ```code block```（fenced；不做语法高亮）
 *   - > blockquote
 *   - - / * / 1. 有序无序列表（单层；嵌套退化为缩进）
 *   - [text](url) 链接
 *   - HTML entity 解码（&lt; &gt; &amp; &quot; &#39; &nbsp; &#NNN;）
 *   - 段落（双换行）/ 软换行（单换行 → <br>）
 *
 * 不支持：嵌套列表深度 >1、表格、图片、HTML 直传、脚注、math。
 * 这些需要正经 markdown 库（marked/react-markdown）—— 后续按需升级。
 */
import { Fragment, type ReactNode } from 'react'

interface Props {
  source: string
}

export default function MarkdownView({ source }: Props) {
  const text = decodeEntities(source)
  const blocks = parseBlocks(text)
  return (
    <div className="md-view" style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--text)' }}>
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  )
}

// ── HTML entity decoder ─────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
}

// ── Block parser ────────────────────────────────────────────────────────────

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'hr' }
  | { kind: 'table'; header: string[]; rows: string[][]; align: ('left'|'center'|'right'|null)[] }

// Box-drawing 字符（U+2500–U+257F）+ 常见连接符
const BOX_CHARS = /[─│┌┐└┘├┤┬┴┼━┃┏┓┗┛┣┫┳┻╋═║╔╗╚╝╠╣╦╩╬┄┅┈┉]/

/** ASCII 图 / 列对齐启发式：含框线字符 或 行中部出现 ≥3 连续空格（中文环境下还要看全角空格） */
function looksLikeAsciiArt(lines: string[]): boolean {
  let hits = 0
  for (const ln of lines) {
    if (BOX_CHARS.test(ln)) return true                      // 一行有框线就直接判定
    if (/\S {3,}\S/.test(ln) || /\S\u3000+\S/.test(ln)) hits++
  }
  return hits >= 2 && hits / lines.length >= 0.4
}

/** 一行像表格行（首尾都是 |，且至少 2 列） */
function isTableRow(s: string): boolean {
  if (!/^\s*\|/.test(s) || !/\|\s*$/.test(s)) return false
  // 至少 1 个非起首/结尾的 |，意味着 ≥2 列
  const inner = s.trim().slice(1, -1)
  return inner.includes('|')
}

/** 表头分隔行：|---|---|，可带 :--- 表对齐 */
function isTableSep(s: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s)
}

function splitRow(s: string): string[] {
  const trimmed = s.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((c) => c.trim())
}

function parseAlign(sep: string): ('left'|'center'|'right'|null)[] {
  return splitRow(sep).map((c) => {
    const s = c.trim()
    const left = s.startsWith(':')
    const right = s.endsWith(':')
    if (left && right)  return 'center'
    if (right)          return 'right'
    if (left)           return 'left'
    return null
  })
}

function parseBlocks(input: string): Block[] {
  const lines = input.split(/\r?\n/)
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // markdown table —— 必须在 paragraph 之前判定
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line)
      const align = parseAlign(lines[i + 1])
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = splitRow(lines[i])
        // 列数对齐到 header
        while (cells.length < header.length) cells.push('')
        if (cells.length > header.length) cells.length = header.length
        rows.push(cells)
        i++
      }
      out.push({ kind: 'table', header, rows, align })
      continue
    }
    // fenced code
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++ // skip closing ```
      out.push({ kind: 'code', lang, text: buf.join('\n') })
      continue
    }
    // 缩进代码块（markdown 规范：4 空格或 tab 前缀）
    if (/^(    |\t)/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && (/^(    |\t)/.test(lines[i]) || /^\s*$/.test(lines[i]))) {
        buf.push(lines[i].replace(/^(    |\t)/, ''))
        i++
      }
      out.push({ kind: 'code', lang: '', text: buf.join('\n').replace(/\s+$/, '') })
      continue
    }
    // hr
    if (/^\s*[-*_]{3,}\s*$/.test(line)) { out.push({ kind: 'hr' }); i++; continue }
    // heading
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (h) { out.push({ kind: 'heading', level: h[1].length, text: h[2] }); i++; continue }
    // blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      out.push({ kind: 'quote', lines: buf })
      continue
    }
    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i++
      }
      out.push({ kind: 'ul', items: buf })
      continue
    }
    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      out.push({ kind: 'ol', items: buf })
      continue
    }
    // blank line
    if (/^\s*$/.test(line)) { i++; continue }
    // paragraph: accumulate non-blank, non-special lines
    const buf: string[] = [line]
    i++
    while (i < lines.length
        && !/^\s*$/.test(lines[i])
        && !/^#{1,6}\s+/.test(lines[i])
        && !/^>\s?/.test(lines[i])
        && !/^\s*[-*+]\s+/.test(lines[i])
        && !/^\s*\d+\.\s+/.test(lines[i])
        && !/^```/.test(lines[i])
        && !/^\s*[-*_]{3,}\s*$/.test(lines[i])) {
      buf.push(lines[i]); i++
    }
    // 退化表格：所有行都是 | a | b | 形态但没分隔符（很多文档手写时漏了）
    const tableLikeRows = buf.filter(isTableRow)
    if (tableLikeRows.length >= 2 && tableLikeRows.length / buf.length >= 0.8) {
      const header = splitRow(tableLikeRows[0])
      const rows = tableLikeRows.slice(1).map((r) => {
        const cells = splitRow(r)
        while (cells.length < header.length) cells.push('')
        if (cells.length > header.length) cells.length = header.length
        return cells
      })
      out.push({ kind: 'table', header, rows, align: header.map(() => null) })
      continue
    }
    // ASCII 框线图 / 列对齐 → 强制走 code block，避免 HTML 折叠空格 + 比例字体毁布局
    if (looksLikeAsciiArt(buf)) {
      out.push({ kind: 'code', lang: '', text: buf.join('\n') })
    } else {
      out.push({ kind: 'paragraph', lines: buf })
    }
  }
  return out
}

// ── Block renderer ──────────────────────────────────────────────────────────

function renderBlock(b: Block, key: number): ReactNode {
  switch (b.kind) {
    case 'heading': {
      const Tag = (`h${Math.min(6, Math.max(1, b.level))}`) as 'h1'|'h2'|'h3'|'h4'|'h5'|'h6'
      const sizes: Record<number, number> = { 1: 22, 2: 18, 3: 16, 4: 14, 5: 13, 6: 12 }
      return (
        <Tag key={key} style={{
          fontSize: sizes[b.level], fontWeight: 700, color: 'var(--text)',
          margin: b.level <= 2 ? '24px 0 10px' : '18px 0 6px', lineHeight: 1.3,
        }}>
          {renderInline(b.text)}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p key={key} style={{ margin: '8px 0' }}>
          {b.lines.map((ln, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {renderInline(ln)}
            </Fragment>
          ))}
        </p>
      )
    case 'quote':
      return (
        <blockquote key={key} style={{
          margin: '10px 0', padding: '6px 14px',
          borderLeft: '3px solid var(--p, #6C47FF)',
          background: 'rgba(108,71,255,0.04)',
          color: 'var(--muted)', fontSize: 13, lineHeight: 1.7,
          borderRadius: '0 4px 4px 0',
        }}>
          {b.lines.map((ln, i) => (
            <div key={i}>{renderInline(ln)}</div>
          ))}
        </blockquote>
      )
    case 'code':
      return (
        <pre key={key} style={{
          background: '#f7f7fa', border: '1px solid var(--border)',
          borderRadius: 6, padding: '10px 14px', fontSize: 12,
          fontFamily: 'ui-monospace, "Cascadia Code", monospace',
          overflowX: 'auto', margin: '10px 0', lineHeight: 1.55,
        }}>
          <code>{b.text}</code>
        </pre>
      )
    case 'ul':
      return (
        <ul key={key} style={{ paddingLeft: 22, margin: '8px 0' }}>
          {b.items.map((it, i) => (
            <li key={i} style={{ margin: '3px 0' }}>{renderInline(it)}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol key={key} style={{ paddingLeft: 22, margin: '8px 0' }}>
          {b.items.map((it, i) => (
            <li key={i} style={{ margin: '3px 0' }}>{renderInline(it)}</li>
          ))}
        </ol>
      )
    case 'hr':
      return <hr key={key} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
    case 'table':
      return (
        <div key={key} style={{ overflowX: 'auto', margin: '12px 0' }}>
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            fontSize: 13, lineHeight: 1.5,
          }}>
            <thead>
              <tr>
                {b.header.map((h, ci) => (
                  <th key={ci} style={{
                    padding: '8px 12px',
                    border: '1px solid var(--border)',
                    background: '#f9fafb',
                    fontWeight: 600,
                    color: 'var(--text)',
                    textAlign: b.align[ci] ?? 'left',
                    whiteSpace: 'nowrap',
                  }}>{renderInline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri} style={{
                  background: ri % 2 === 0 ? '#fff' : '#fafafa',
                }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{
                      padding: '7px 12px',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      textAlign: b.align[ci] ?? 'left',
                      verticalAlign: 'top',
                    }}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

// ── Inline parser：**bold** / *italic* / `code` / [text](url) ───────────────
// 用 token 化避免互相打架；不支持嵌套（够用就行）

type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'image'; alt: string; url: string }

function tokenizeInline(input: string): Inline[] {
  const out: Inline[] = []
  let s = input
  while (s.length > 0) {
    let m: RegExpExecArray | null
    // inline code first（最高优先级）
    if ((m = /^`([^`]+)`/.exec(s))) { out.push({ kind: 'code', text: m[1] }); s = s.slice(m[0].length); continue }
    // bold
    if ((m = /^\*\*([^*]+)\*\*/.exec(s))) { out.push({ kind: 'bold', text: m[1] }); s = s.slice(m[0].length); continue }
    if ((m = /^__([^_]+)__/.exec(s))) { out.push({ kind: 'bold', text: m[1] }); s = s.slice(m[0].length); continue }
    // italic
    if ((m = /^\*([^*]+)\*/.exec(s))) { out.push({ kind: 'italic', text: m[1] }); s = s.slice(m[0].length); continue }
    if ((m = /^_([^_]+)_/.exec(s))) { out.push({ kind: 'italic', text: m[1] }); s = s.slice(m[0].length); continue }
    // image —— 必须在 link 之前匹配
    if ((m = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(s))) {
      out.push({ kind: 'image', alt: m[1], url: m[2] })
      s = s.slice(m[0].length)
      continue
    }
    // link
    if ((m = /^\[([^\]]+)\]\(([^)]+)\)/.exec(s))) {
      out.push({ kind: 'link', text: m[1], url: m[2] })
      s = s.slice(m[0].length)
      continue
    }
    // 普通字符：吞到下一个特殊字符
    const next = s.search(/[`*_[!]/)
    if (next === -1) { out.push({ kind: 'text', text: s }); break }
    if (next === 0) { out.push({ kind: 'text', text: s[0] }); s = s.slice(1); continue }
    out.push({ kind: 'text', text: s.slice(0, next) })
    s = s.slice(next)
  }
  return out
}

function renderInline(input: string): ReactNode {
  const tokens = tokenizeInline(input)
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.kind) {
          case 'text':   return <Fragment key={i}>{t.text}</Fragment>
          case 'bold':   return <strong key={i}>{t.text}</strong>
          case 'italic': return <em key={i}>{t.text}</em>
          case 'code':   return (
            <code key={i} style={{
              background: '#f3f4f6', padding: '1px 5px', borderRadius: 3, fontSize: 12,
              fontFamily: 'ui-monospace, "Cascadia Code", monospace',
            }}>{t.text}</code>
          )
          case 'link':   return (
            <a key={i} href={t.url} target="_blank" rel="noopener noreferrer"
               style={{ color: 'var(--p, #6C47FF)', textDecoration: 'none' }}>{t.text}</a>
          )
          case 'image':  return (
            <span key={i} style={{
              display: 'block', margin: '12px 0', textAlign: 'center',
            }}>
              <img
                src={t.url}
                alt={t.alt}
                loading="lazy"
                style={{
                  maxWidth: '100%', maxHeight: 480,
                  border: '1px solid var(--border)', borderRadius: 8,
                  background: '#fafafa',
                }}
                onError={(e) => {
                  // 加载失败时降级为 alt 文本，避免破图
                  const img = e.currentTarget
                  const fallback = document.createElement('span')
                  fallback.textContent = `🖼 ${t.alt || '(图片加载失败)'}`
                  fallback.style.color = 'var(--muted)'
                  fallback.style.fontSize = '12px'
                  img.replaceWith(fallback)
                }}
              />
              {t.alt && (
                <span style={{
                  display: 'block', fontSize: 11, color: 'var(--muted)',
                  marginTop: 4, fontStyle: 'italic',
                }}>{t.alt}</span>
              )}
            </span>
          )
        }
      })}
    </>
  )
}
