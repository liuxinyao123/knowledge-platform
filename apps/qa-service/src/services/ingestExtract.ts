/**
 * 方案 B：服务端从常见办公/文档格式抽取纯文本，供 BookStack 页面与 RAG 使用。
 *
 * 外挂：设置环境变量 INGEST_EXTRACT_HOOK=/绝对路径/your-hook.mjs
 * 模块导出 async (input) => { kind:'text', text } | { kind:'attachment_only', hint } | null
 * 返回 null 时继续走内置逻辑（可与 Cursor / 自建 SKILL 生成的脚本对接）。
 */
import path from 'node:path'
import officeParser from 'officeparser'
import { runIngestExtractHook } from './ingestExtractHook.ts'
import { runTextSkillExtract } from './skillTextExtract.ts'

const TEXT_EXT = new Set(['.md', '.html', '.htm', '.txt', '.csv'])

/** officeparser 覆盖：pdf / ooxml / odf / rtf 等 */
const OFFICE_EXT = new Set([
  '.pdf',
  '.ppt',
  '.pptx',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.odt',
  '.odp',
  '.ods',
  '.rtf',
])

const DXF_EXT = new Set(['.dxf'])

/** 无法可靠解析正文的工程格式：入库时走「页面 + 附件」 */
const ATTACHMENT_ONLY_EXT = new Set([
  '.dwg',
  '.cad',
  '.step',
  '.stp',
  '.iges',
  '.igs',
  '.stl',
  '.sat',
  '.3dm',
])

export const INGEST_ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  ...TEXT_EXT,
  ...OFFICE_EXT,
  ...DXF_EXT,
  ...ATTACHMENT_ONLY_EXT,
])

export type ExtractOutcome =
  | { kind: 'text'; text: string; summary?: string | null }
  | { kind: 'attachment_only'; hint: string }

function tryDecodeAsText(buf: Buffer): string | null {
  try {
    const u = buf.toString('utf8')
    if (!/[\x00-\x08\x0e-\x1f]/.test(u.slice(0, 4000))) return u
  } catch {
    /* ignore */
  }
  try {
    return buf.toString('latin1')
  } catch {
    return null
  }
}

function looksLikeDxf(s: string): boolean {
  const head = s.slice(0, 800).toUpperCase()
  return head.includes('SECTION') && /^\s*\d+\s*$/m.test(s.slice(0, 200))
}

function dxfMarkdownBody(s: string): string {
  const max = 500_000
  const body = s.length > max ? `${s.slice(0, max)}\n\n…（已截断）` : s
  return `# DXF 文本摘录\n\n\`\`\`\n${body}\n\`\`\`\n`
}

async function extractOfficeBuffer(buffer: Buffer): Promise<string> {
  const ocrEnabled = process.env.INGEST_OCR === '1' || process.env.INGEST_OCR === 'true'

  // 优先 tesseract.js（INGEST_OCR_ENGINE=tesseract 且已装）；失败或未装则走 officeparser
  if (ocrEnabled) {
    const { runTesseractOcr } = await import('./tesseractOcr.ts')
    const tess = await runTesseractOcr(buffer)
    if (tess) return tess.trim()
  }

  const ast = await officeParser.parseOffice(buffer, { ocr: ocrEnabled })
  return ast.toText().trim()
}

export async function extractDocument(originalName: string, buffer: Buffer): Promise<ExtractOutcome> {
  const ext = path.extname(originalName).toLowerCase()
  if (!ext) {
    throw new Error('文件缺少扩展名')
  }
  if (!INGEST_ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的扩展名：${ext}`)
  }

  const hooked = await runIngestExtractHook({ originalName, ext, buffer }).catch((e) => {
    throw e instanceof Error ? e : new Error(String(e))
  })
  if (hooked) {
    return hooked
  }

  if (TEXT_EXT.has(ext)) {
    const skilled = runTextSkillExtract(originalName, buffer)
    if (skilled?.markdown) {
      return { kind: 'text', text: skilled.markdown, summary: skilled.summary }
    }
    return { kind: 'text', text: buffer.toString('utf8') }
  }

  if (ATTACHMENT_ONLY_EXT.has(ext)) {
    return {
      kind: 'attachment_only',
      hint:
        '该格式为二进制或工程交换文件，无法在服务端稳定抽取正文。已创建说明页并挂载原文件；检索以本页文字为主，详细内容请下载附件。',
    }
  }

  if (DXF_EXT.has(ext)) {
    const raw = tryDecodeAsText(buffer)
    if (raw && looksLikeDxf(raw)) {
      return { kind: 'text', text: dxfMarkdownBody(raw) }
    }
    return {
      kind: 'attachment_only',
      hint: '该 DXF 无法作为可读文本解析（可能为二进制 DXF）。已改为仅附件入库，可尝试另存为 ASCII DXF 或导出 PDF 后重新上传。',
    }
  }

  if (OFFICE_EXT.has(ext)) {
    try {
      const text = await extractOfficeBuffer(buffer)
      if (text.length > 0) {
        return { kind: 'text', text }
      }
    } catch {
      /* fall through to attachment */
    }
    return {
      kind: 'attachment_only',
      hint: '未能从该文件中解析出文本（可能为扫描件、加密或旧版二进制 Office）。已改为仅附件入库；可尝试导出为 PDF / DOCX / PPTX 后重试。',
    }
  }

  throw new Error(`未实现的扩展名：${ext}`)
}
