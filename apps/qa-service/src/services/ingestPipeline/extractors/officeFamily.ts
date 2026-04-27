/**
 * officeFamily.ts —— pptx / xlsx 提取
 *
 * pptx:
 *   沿用 officeparser.parseOffice(buffer).toText()，按 `\n{2,}` 切段落。
 *   officeparser 在页/节之间会吐空行，分隔逻辑稳定。
 *
 * xlsx（2026-04-24 BUG-xlsx-01 根治）:
 *   officeparser xlsx 的 toText() 每行单换行，原来按 `\n{2,}` 切会把整表糊成一坨：
 *     · 整包被 textHygiene 或长度限制过滤 → 0 chunks，用户看到 "0 切片 · 0 图"
 *     · 即使侥幸过，1 条 paragraph 也无法支撑行级检索（Excel 问答最需要的能力）
 *   改法：直接用 officeparser 返回的 AST（content[].children[].children[]）：
 *     1. 每个 sheet 写一条 heading chunk（便于 "Sheet: 销售明细" 命中）
 *     2. 每行拼 `cell1 | cell2 | cell3` 写一条 paragraph chunk，前缀带 sheet 名
 *   若 AST 不可用则降级到 toText() 单换行 split；最终还是 0 chunks 则抛错让
 *   job 状态走 failed（不再静默"完成"）。
 */
import type { Extractor, ExtractResult, ExtractorId, ExtractedChunk } from '../types.ts'

// officeparser AST 节点（我们只用到 type/children/text/metadata 几个字段）
interface OpNode {
  type?: string
  text?: string
  children?: OpNode[]
  metadata?: { sheetName?: string }
}

async function loadParseOffice(): Promise<(
  buffer: Buffer,
  config?: Record<string, unknown>,
) => Promise<unknown>> {
  const mod: any = await import('officeparser')
  const fn = mod.parseOffice ?? mod.default?.parseOffice ?? mod.default
  if (typeof fn !== 'function') {
    throw new Error('officeparser.parseOffice not found')
  }
  return fn
}

function astToText(ast: unknown): string {
  const a: any = ast
  if (!a) return ''
  if (typeof a === 'string') return a
  if (typeof a.toText === 'function') return a.toText()
  if (typeof a.text === 'string') return a.text
  return ''
}

export const pptxExtractor: Extractor = {
  id: 'pptx',
  async extract(buffer) {
    const warnings: string[] = []
    let text = ''
    try {
      const parseOffice = await loadParseOffice()
      const ocrEnabled = process.env.INGEST_OCR === 'true' || process.env.INGEST_OCR === '1'
      const ast = await parseOffice(buffer, { ocr: ocrEnabled })
      text = astToText(ast).trim()
    } catch (e) {
      warnings.push(`officeparser pptx failed: ${e instanceof Error ? e.message : 'unknown'}`)
    }
    const paragraphs = text
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean)
    return {
      chunks: paragraphs.map((p) => ({ kind: 'paragraph' as const, text: p })),
      images: [],
      fullText: text,
      warnings,
      extractorId: 'pptx' as ExtractorId,
    } satisfies ExtractResult
  },
}

/** 把一行 cells 按 ` | ` 拼起来；全空返回 '' */
function rowToLine(row: OpNode): string {
  const cells = Array.isArray(row?.children) ? row.children : []
  const parts: string[] = []
  for (const c of cells) {
    const t = typeof c?.text === 'string' ? c.text.trim() : ''
    if (t.length > 0) parts.push(t)
  }
  return parts.join(' | ')
}

/**
 * 软聚合目标：单个 paragraph chunk 约这么多字。超过就 flush 成新 chunk。
 * 选 500 的理由：既大于 textHygiene.MIN_CHUNK_CHARS(20) 让 gate 全部放行，
 * 又不至于把整张表糊成一坨丢失行级定位能力。
 */
const XLSX_CHUNK_TARGET_CHARS = 500

export const xlsxExtractor: Extractor = {
  id: 'xlsx',
  async extract(buffer) {
    const warnings: string[] = []
    const chunks: ExtractedChunk[] = []
    let fullText = ''
    let sheetCount = 0

    try {
      const parseOffice = await loadParseOffice()
      const ast = (await parseOffice(buffer, {})) as { content?: OpNode[] } & Record<string, unknown>
      const sheets: OpNode[] = Array.isArray(ast?.content) ? ast.content : []

      if (sheets.length > 0) {
        // 路径 A：AST 可用 —— 按 sheet 行聚合成块
        //
        // 设计要点（2026-04-24 BUG-xlsx-02）：
        //   · 每 sheet 一条 heading chunk（仍然）
        //   · 行不再各自成 chunk；而是聚合成 ~500 字一组的 paragraph chunk
        //     每组前缀 `Sheet: XXX\n`，保证即使短表（评测集这种每行 5~10 字）
        //     单个 chunk 也能通过 textHygiene.isBadChunk(MIN_CHUNK_CHARS=20)
        //   · 聚合不损失行级定位：chunk 内部用 \n 保留原行结构
        //   · 大表按目标字数自动切成多个 chunk，每块都带 sheet 前缀
        for (const sheet of sheets) {
          if (sheet?.type !== 'sheet') continue
          sheetCount++
          const sheetName = sheet.metadata?.sheetName || `Sheet${sheetCount}`
          chunks.push({
            kind: 'heading',
            text: `Sheet: ${sheetName}`,
            headingLevel: 1,
            headingPath: sheetName,
          })

          const rows = Array.isArray(sheet.children) ? sheet.children : []
          let buffer: string[] = []
          let bufLen = 0
          const flush = (): void => {
            if (buffer.length === 0) return
            // 前缀 sheet 名，让每条 chunk 语义自洽
            const text = `Sheet: ${sheetName}\n${buffer.join('\n')}`
            chunks.push({
              kind: 'paragraph',
              text,
              headingPath: sheetName,
            })
            buffer = []
            bufLen = 0
          }

          for (const row of rows) {
            const line = rowToLine(row)
            if (line.length < 1) continue
            // 如果当前块已经接近目标字数，flush 后开新块
            if (bufLen > 0 && bufLen + line.length + 1 > XLSX_CHUNK_TARGET_CHARS) {
              flush()
            }
            buffer.push(line)
            bufLen += line.length + 1   // +1 = \n
          }
          flush()  // 收尾
        }
        fullText = chunks.map((c) => c.text).join('\n')
      } else {
        // 路径 B：AST 为空 —— 降级到 toText() 聚合 split
        warnings.push('xlsx AST empty, falling back to toText()')
        const text = astToText(ast).trim()
        fullText = text
        // 按目标字数聚合（而不是按单换行 split），保证单块够长
        let buffer: string[] = []
        let bufLen = 0
        for (const line of text.split('\n')) {
          const t = line.trim()
          if (!t) continue
          if (bufLen > 0 && bufLen + t.length + 1 > XLSX_CHUNK_TARGET_CHARS) {
            chunks.push({ kind: 'paragraph', text: buffer.join('\n') })
            buffer = []; bufLen = 0
          }
          buffer.push(t)
          bufLen += t.length + 1
        }
        if (buffer.length > 0) chunks.push({ kind: 'paragraph', text: buffer.join('\n') })
      }
    } catch (e) {
      warnings.push(`officeparser xlsx failed: ${e instanceof Error ? e.message : 'unknown'}`)
    }

    // 路径 C：仍然 0 chunks → 显式抛错让上层 job 走 failed；不再静默"完成"
    if (chunks.length === 0) {
      const reason = warnings.length ? warnings.join('; ') : 'xlsx produced 0 rows'
      throw new Error(`xlsx extraction yielded no chunks: ${reason}`)
    }

    return {
      chunks,
      images: [],
      fullText,
      warnings,
      extractorId: 'xlsx' as ExtractorId,
    } satisfies ExtractResult
  },
}
