import { pathToFileURL } from 'node:url'

/** 外挂模块：默认导出或命名导出 ingestExtract */
export type IngestExtractHookInput = {
  originalName: string
  ext: string
  buffer: Buffer
}

export type IngestExtractHookResult =
  | { kind: 'text'; text: string }
  | { kind: 'attachment_only'; hint: string }

let cachedHook:
  | ((input: IngestExtractHookInput) => Promise<IngestExtractHookResult | null | undefined>)
  | null
  | undefined

type HookFn = (input: IngestExtractHookInput) => Promise<IngestExtractHookResult | null | undefined>

async function loadHook(): Promise<HookFn> {
  const p = process.env.INGEST_EXTRACT_HOOK?.trim()
  if (!p) {
    return async () => null
  }
  const href = pathToFileURL(p).href
  const mod = await import(href)
  const fn = (mod as { default?: unknown; ingestExtract?: unknown }).default ?? mod.ingestExtract
  if (typeof fn !== 'function') {
    throw new Error('INGEST_EXTRACT_HOOK 模块须默认导出函数，或导出命名函数 ingestExtract')
  }
  return fn as HookFn
}

export async function runIngestExtractHook(
  input: IngestExtractHookInput,
): Promise<IngestExtractHookResult | null> {
  if (cachedHook === undefined) {
    try {
      cachedHook = await loadHook()
    } catch (e) {
      cachedHook = null
      throw e
    }
  }
  if (!cachedHook) return null
  const out = await cachedHook(input)
  if (!out) return null
  if (out.kind === 'text') {
    const t = out.text?.trim() ?? ''
    return t ? { kind: 'text', text: t } : null
  }
  return { kind: 'attachment_only', hint: out.hint || '此外挂逻辑要求仅附件入库。' }
}
