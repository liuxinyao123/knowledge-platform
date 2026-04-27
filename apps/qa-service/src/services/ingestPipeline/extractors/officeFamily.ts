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

/**
 * SheetJS 兜底解析 xlsx（ADR-34 v3 · 2026-04-26）
 *
 * 背景：实测某些 xlsx 文件 officeparser 给出 AST.content 有 sheet 但 sheet.children 为
 *   空数组（比如 GM_尾门工程最佳实践_评测集.xlsx，openpyxl 能读出 71×9 数据）。
 *   这是 officeparser 解析 worksheet XML 的已知不稳。
 *
 * SheetJS（xlsx 包，从官方 CDN 安装）几乎万能，对中文 sheet 名 / 合并单元格 / 公式都稳。
 * 失败时返回 null，让上层回到 toText() 兜底链。
 */
async function parseXlsxWithSheetJS(
  buffer: Buffer,
): Promise<Array<{ sheetName: string; rows: string[][] }> | null> {
  try {
    // @ts-ignore xlsx 通过 SheetJS CDN 安装（package.json 里指向 cdn.sheetjs.com tarball），
    //    但 tsc 在装包前看不到类型；运行时由 pnpm 装上后正常加载
    const mod: any = await import('xlsx')
    const XLSX = mod.default ?? mod
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: false })
    const out: Array<{ sheetName: string; rows: string[][] }> = []
    for (const name of wb.SheetNames || []) {
      const sheet = wb.Sheets[name]
      if (!sheet) continue
      // sheet_to_json with header:1 → 2D 数组，每行 cells；空 cell 用 '' 占位
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        raw: false,         // 走显示格式（日期/数字会被格式化为字符串）
        blankrows: false,
      })
      const cleanRows: string[][] = rows.map((row) =>
        row.map((cell) => (cell == null ? '' : String(cell).trim())),
      )
      out.push({ sheetName: name, rows: cleanRows })
    }
    return out
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[xlsx] SheetJS fallback failed:', (err as Error).message.slice(0, 200))
    return null
  }
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

        // 修复（2026-04-26 · ADR-34 v3）：如果 AST 有 sheet 但行全为空
        //   （officeparser 对中文 sheet 名 / 合并单元格的 xlsx 已知 AST.children 解析不稳；
        //   实测 GM_尾门工程最佳实践_评测集.xlsx 71×9 完整数据，officeparser AST 0 行）
        //
        // 兜底链：SheetJS → toText()。SheetJS 几乎万能，toText() 是最后保底。
        const paragraphCount = chunks.filter((c) => c.kind === 'paragraph').length
        if (paragraphCount === 0) {
          warnings.push('xlsx officeparser AST yielded 0 rows; falling back to SheetJS')
          const sjs = await parseXlsxWithSheetJS(buffer)
          if (sjs && sjs.some((s) => s.rows.length > 0)) {
            // SheetJS 成功 —— 重置 chunks（清掉 officeparser 的 heading 占位），重新出全套
            chunks.length = 0
            sheetCount = 0
            for (const sheet of sjs) {
              if (sheet.rows.length === 0) continue
              sheetCount++
              chunks.push({
                kind: 'heading',
                text: `Sheet: ${sheet.sheetName}`,
                headingLevel: 1,
                headingPath: sheet.sheetName,
              })
              let buffer2: string[] = []
              let bufLen2 = 0
              const flush2 = (): void => {
                if (buffer2.length === 0) return
                const text = `Sheet: ${sheet.sheetName}\n${buffer2.join('\n')}`
                chunks.push({ kind: 'paragraph', text, headingPath: sheet.sheetName })
                buffer2 = []
                bufLen2 = 0
              }
              for (const row of sheet.rows) {
                // 把行 cells 拼成 `cell1 | cell2 | cell3`，空 cell 跳过
                const line = row.filter((c) => c.length > 0).join(' | ')
                if (line.length === 0) continue
                if (bufLen2 > 0 && bufLen2 + line.length + 1 > XLSX_CHUNK_TARGET_CHARS) {
                  flush2()
                }
                buffer2.push(line)
                bufLen2 += line.length + 1
              }
              flush2()
            }
            fullText = chunks.map((c) => c.text).join('\n')
            warnings.push(`SheetJS recovered ${sheetCount} sheets, ${chunks.filter(c => c.kind === 'paragraph').length} paragraphs`)
          } else {
            // SheetJS 也失败 —— 最后兜到 toText()
            warnings.push('SheetJS fallback also empty; falling back to toText()')
            const fallback = astToText(ast).trim()
            if (fallback.length > 0) {
              let buffer3: string[] = []
              let bufLen3 = 0
              for (const line of fallback.split('\n')) {
                const t = line.trim()
                if (!t) continue
                if (bufLen3 > 0 && bufLen3 + t.length + 1 > XLSX_CHUNK_TARGET_CHARS) {
                  chunks.push({ kind: 'paragraph', text: buffer3.join('\n') })
                  buffer3 = []; bufLen3 = 0
                }
                buffer3.push(t)
                bufLen3 += t.length + 1
              }
              if (buffer3.length > 0) chunks.push({ kind: 'paragraph', text: buffer3.join('\n') })
              fullText = fullText + '\n' + fallback
            }
          }
        }
      } else {
        // 路径 B：AST 整个 sheet 列表都为空 —— SheetJS 兜底
        warnings.push('xlsx AST empty, falling back to SheetJS')
        const sjs = await parseXlsxWithSheetJS(buffer)
        if (sjs && sjs.some((s) => s.rows.length > 0)) {
          for (const sheet of sjs) {
            if (sheet.rows.length === 0) continue
            sheetCount++
            chunks.push({
              kind: 'heading',
              text: `Sheet: ${sheet.sheetName}`,
              headingLevel: 1,
              headingPath: sheet.sheetName,
            })
            let buffer: string[] = []
            let bufLen = 0
            const flush = (): void => {
              if (buffer.length === 0) return
              const text = `Sheet: ${sheet.sheetName}\n${buffer.join('\n')}`
              chunks.push({ kind: 'paragraph', text, headingPath: sheet.sheetName })
              buffer = []
              bufLen = 0
            }
            for (const row of sheet.rows) {
              const line = row.filter((c) => c.length > 0).join(' | ')
              if (line.length === 0) continue
              if (bufLen > 0 && bufLen + line.length + 1 > XLSX_CHUNK_TARGET_CHARS) flush()
              buffer.push(line)
              bufLen += line.length + 1
            }
            flush()
          }
          fullText = chunks.map((c) => c.text).join('\n')
        } else {
          // SheetJS 也空 → 最后保底 toText()
          warnings.push('SheetJS also empty, falling back to toText()')
          const text = astToText(ast).trim()
          fullText = text
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
