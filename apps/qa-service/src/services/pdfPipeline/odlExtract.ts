/**
 * pdfPipeline/odlExtract.ts —— @opendataloader/pdf 软依赖封装
 *
 * 行为：
 *   - 写临时文件 → convert → 读 outputDir 下的 *.json + 抽出的图片
 *   - 失败（未装 / Java 缺失 / convert 抛错）→ 抛 OdlNotAvailableError
 *
 * 输出结构：
 *   { jsonPath, markdownPath?, imageFiles: { fileName, absPath, ext }[] }
 *
 * 软依赖通过动态字符串 import 绕过 TS 模块解析；未装时 @opendataloader/pdf 会抛 ERR_MODULE_NOT_FOUND。
 */
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isJavaAvailable } from './javaCheck.ts'
import { OdlNotAvailableError } from './types.ts'

export interface OdlConvertResult {
  jsonPath: string
  jsonContent: unknown
  imageFiles: Array<{ fileName: string; absPath: string; ext: 'png' | 'jpg' | 'jpeg' }>
  /** 临时工作目录；调用方拿完结果后调 cleanup() */
  cleanup: () => Promise<void>
}

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg'])

export async function odlConvert(
  buffer: Buffer,
  originalName: string,
): Promise<OdlConvertResult> {
  if (!isJavaAvailable()) {
    throw new OdlNotAvailableError('java not available in PATH')
  }

  // 软依赖动态 import
  let mod: any
  try {
    const modName = '@opendataloader/pdf'
    mod = await import(modName)
  } catch (e) {
    throw new OdlNotAvailableError(
      `@opendataloader/pdf not installed: ${(e as Error).message}`,
    )
  }
  const convert = mod.convert ?? mod.default?.convert
  if (typeof convert !== 'function') {
    throw new OdlNotAvailableError('@opendataloader/pdf has no `convert` export')
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'odl-'))
  const inFile = path.join(workDir, sanitizeBaseName(originalName))
  const outDir = path.join(workDir, 'out')

  const cleanup = async (): Promise<void> => {
    try { await rm(workDir, { recursive: true, force: true }) } catch { /* swallow */ }
  }

  try {
    await writeFile(inFile, buffer)
    // ODL Node API 对应 CLI flag（参考 npx @opendataloader/pdf --help）：
    //   outputDir   → -o / --output-dir
    //   format      → -f / --format
    //   imageOutput → --image-output (off | embedded | external)
    //   imageFormat → --image-format
    //   imageDir    → --image-dir
    //   quiet       → -q   （默认会把 Java INFO/WARN 打到父进程 stdout/stderr）
    await convert([inFile], {
      outputDir: outDir,
      format: 'json,markdown',
      imageOutput: 'external',
      imageFormat: 'png',
      imageDir: path.join(outDir, 'images'),
      quiet: true,
    })

    // 在 outDir 里找 .json 主文件 + 图片
    const entries = await collectFiles(outDir)
    const jsonEntry = entries.find((p) => p.endsWith('.json'))
    if (!jsonEntry) {
      throw new OdlNotAvailableError('odl produced no json output')
    }
    const jsonRaw = await readFile(jsonEntry, 'utf8')
    let jsonContent: unknown
    try {
      jsonContent = JSON.parse(jsonRaw)
    } catch (e) {
      throw new OdlNotAvailableError(`odl json parse failed: ${(e as Error).message}`)
    }

    const imageFiles = entries
      .filter((p) => IMG_EXT.has(path.extname(p).toLowerCase()))
      .map((absPath) => ({
        fileName: path.basename(absPath),
        absPath,
        ext: path.extname(absPath).toLowerCase().replace('.', '') as 'png' | 'jpg' | 'jpeg',
      }))

    return { jsonPath: jsonEntry, jsonContent, imageFiles, cleanup }
  } catch (err) {
    await cleanup()
    if (err instanceof OdlNotAvailableError) throw err
    throw new OdlNotAvailableError(
      `odl convert failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

function sanitizeBaseName(name: string): string {
  // 防路径注入；保留扩展名
  const ext = path.extname(name)
  const base = path.basename(name, ext).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
  return `${base || 'doc'}${ext || '.pdf'}`
}

async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...await collectFiles(full))
    } else if (ent.isFile()) {
      out.push(full)
    }
  }
  return out
}
