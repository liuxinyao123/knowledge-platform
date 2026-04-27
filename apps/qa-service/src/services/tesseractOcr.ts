/**
 * services/tesseractOcr.ts —— 可选 OCR 引擎（tesseract.js）
 *
 * 默认不启用：继续走 officeparser 的内置 OCR（够用、无大型二进制依赖）。
 * 需要更强的中文识别时：
 *   1) pnpm --filter qa-service add tesseract.js
 *   2) .env 设置 INGEST_OCR_ENGINE=tesseract 和可选 OCR_LANGS（默认 chi_sim+eng）
 *
 * 本模块用动态 import 对 tesseract.js 做软依赖：未装时 detectOcrEngine() 返 'builtin'；
 * 装了但未启用 env 也返 'builtin'。
 */
export type OcrEngine = 'builtin' | 'tesseract'

export function desiredOcrEngine(): OcrEngine {
  const flag = process.env.INGEST_OCR_ENGINE?.trim().toLowerCase()
  return flag === 'tesseract' ? 'tesseract' : 'builtin'
}

export function ocrLangs(): string {
  return process.env.OCR_LANGS?.trim() || 'chi_sim+eng'
}

/**
 * 尝试用 tesseract.js 对二进制 buffer 做 OCR。
 * 返回 null 表示：未安装 tesseract.js / 初始化失败 / 识别失败。调用方应降级。
 */
export async function runTesseractOcr(buffer: Buffer): Promise<string | null> {
  if (desiredOcrEngine() !== 'tesseract') return null

  let mod: any
  try {
    // 软依赖：动态名绕过 TS 模块解析，未装时抛 ERR_MODULE_NOT_FOUND
    const modName = 'tesseract.js'
    mod = await import(modName)
  } catch {
    // eslint-disable-next-line no-console
    console.warn('WARN: INGEST_OCR_ENGINE=tesseract but tesseract.js not installed')
    return null
  }

  try {
    const worker = await mod.createWorker(ocrLangs())
    try {
      const { data } = await worker.recognize(buffer)
      return typeof data?.text === 'string' ? data.text : null
    } finally {
      await worker.terminate()
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('WARN: tesseract ocr failed:', (err as Error).message)
    return null
  }
}

/**
 * 检测并返回实际生效的 OCR 引擎名（用于启动日志）。
 */
export async function detectOcrEngine(): Promise<OcrEngine> {
  if (desiredOcrEngine() !== 'tesseract') return 'builtin'
  try {
    const modName = 'tesseract.js'
    await import(modName)
    return 'tesseract'
  } catch {
    return 'builtin'
  }
}
