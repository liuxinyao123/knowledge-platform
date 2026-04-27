/**
 * 调用 apps/skill/text-preprocess-skill 对 .md / .txt 做结构化预处理，生成入库用 Markdown。
 * 需本机 Python 与 skill 依赖；失败时返回 null，由 ingestExtract 回退为纯文本读取。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const servicesDir = fileURLToPath(new URL('.', import.meta.url))
const qaServiceRoot = join(servicesDir, '..', '..')
const defaultSkillRoot = join(qaServiceRoot, '..', 'skill', 'text-preprocess-skill')
const defaultConfigPath = join(qaServiceRoot, 'config', 'text-skill-ingest.yaml')

export function isTextSkillEnabled(): boolean {
  const v = process.env.INGEST_USE_TEXT_SKILL?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function safeBasename(name: string): string {
  const base = name.replace(/[/\\]/g, '_').slice(-200)
  return base || 'document.txt'
}

type SkillJson = {
  处理状态?: string
  content_list?: Array<Record<string, unknown>>
  文档摘要?: { 全文摘要?: string }
}

function contentListToMarkdown(list: unknown[]): string {
  const lines: string[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (item.type !== 'text') continue
    const text = String(item.text ?? '').trim()
    if (!text) continue
    const ct = item.content_type
    if (ct === 'heading') {
      const level = Math.min(6, Math.max(1, Number(item.text_level) || 1))
      lines.push(`${'#'.repeat(level)} ${text}\n\n`)
    } else {
      lines.push(`${text}\n\n`)
    }
  }
  return lines.join('').trim()
}

export type TextSkillExtractOk = {
  markdown: string
  summary: string | null
}

/**
 * @returns 成功时返回 markdown + 可选摘要；不应抛错，失败返回 null
 */
export function runTextSkillExtract(originalName: string, buffer: Buffer): TextSkillExtractOk | null {
  if (!isTextSkillEnabled()) return null

  const skillRoot = process.env.TEXT_PREPROCESS_SKILL_ROOT?.trim() || defaultSkillRoot
  const pythonBin = process.env.TEXT_SKILL_PYTHON?.trim() || 'python3'
  const configPath = process.env.TEXT_SKILL_INGEST_CONFIG?.trim() || defaultConfigPath

  const script = join(skillRoot, 'scripts', 'preprocess_text.py')
  let tmp = ''
  try {
    tmp = mkdtempSync(join(tmpdir(), 'qa-text-skill-'))
    const inputPath = join(tmp, safeBasename(originalName))
    const outJson = join(tmp, 'out.json')
    writeFileSync(inputPath, buffer)

    const timeoutMs = Math.min(300_000, Math.max(10_000, Number(process.env.TEXT_SKILL_TIMEOUT_MS ?? 120_000)))

    const proc = spawnSync(
      pythonBin,
      [script, inputPath, '-c', configPath, '-o', outJson, '--no-markdown'],
      {
        cwd: skillRoot,
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      },
    )

    if (proc.error || proc.status !== 0) {
      return null
    }

    const raw = readFileSync(outJson, 'utf-8')
    const data = JSON.parse(raw) as SkillJson
    if (data.处理状态 !== '成功') {
      return null
    }

    const summaryRaw = data.文档摘要?.全文摘要?.trim()
    const summary = summaryRaw && summaryRaw.length > 0 ? summaryRaw : null

    const list = Array.isArray(data.content_list) ? data.content_list : []
    let markdown = contentListToMarkdown(list)
    if (!markdown) {
      markdown = buffer.toString('utf8').trim()
    }
    if (!markdown) return null

    if (summary) {
      markdown = `> **摘要**：${summary.replace(/\n+/g, ' ')}\n\n---\n\n${markdown}`
    }

    return { markdown, summary }
  } catch {
    return null
  } finally {
    if (tmp) {
      try {
        rmSync(tmp, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
}
