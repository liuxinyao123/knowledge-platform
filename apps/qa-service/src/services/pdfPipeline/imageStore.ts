/**
 * pdfPipeline/imageStore.ts —— 图片落档 + DB 行写入
 *
 * 路径：infra/asset_images/{assetId}/{page}-{index}.{ext}
 * DB：metadata_asset_image (UNIQUE asset_id + page + index → ON CONFLICT DO NOTHING)
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type pg from 'pg'
import type { PdfImage } from './types.ts'

/**
 * 仓库根定位：本文件位于
 *   {REPO}/apps/qa-service/src/services/pdfPipeline/imageStore.ts
 * → 向上走 6 级得到 REPO
 * 用这种方式避免依赖 process.cwd()（不同启动方式不一致）。
 */
function repoRoot(): string {
  const here = fileURLToPath(import.meta.url)
  return path.resolve(here, '../../../../../..')
}

/**
 * 每次调用时读 env，便于：
 *  - env 未设：默认仓库根下 infra/asset_images（绝对路径，稳定）
 *  - env 绝对路径：直接用
 *  - env 相对路径：相对仓库根解析
 *  - 测试通过 `process.env.ASSET_IMAGE_ROOT = tmpDir` 注入
 */
function rootDir(): string {
  const env = process.env.ASSET_IMAGE_ROOT?.trim()
  if (env) {
    return path.isAbsolute(env) ? env : path.resolve(repoRoot(), env)
  }
  return path.resolve(repoRoot(), 'infra/asset_images')
}

export interface PersistedImage {
  imageId: number
  page: number
  index: number
  filePath: string                      // 仓库相对路径（便于跨机器挪库）
}

export async function persistImages(
  pool: pg.Pool,
  assetId: number,
  images: PdfImage[],
): Promise<PersistedImage[]> {
  if (!images.length) return []
  const rootAbs = rootDir()
  const repoAbs = repoRoot()
  const assetDir = path.join(rootAbs, String(assetId))
  await mkdir(assetDir, { recursive: true })

  const out: PersistedImage[] = []
  for (const img of images) {
    const fname = `${img.page}-${img.index}.${img.ext}`
    const absPath = path.join(assetDir, fname)
    // DB 里存仓库相对路径（便于跨机器/容器迁移）
    const relPath = path.relative(repoAbs, absPath)

    await writeFile(absPath, img.bytes)

    const { rows } = await pool.query(
      `INSERT INTO metadata_asset_image (asset_id, page, image_index, bbox, file_path)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (asset_id, page, image_index)
       DO UPDATE SET file_path = EXCLUDED.file_path
       RETURNING id`,
      [
        assetId,
        img.page,
        img.index,
        img.bbox ? JSON.stringify(img.bbox) : null,
        relPath,
      ],
    )
    out.push({
      imageId: Number(rows[0].id),
      page: img.page,
      index: img.index,
      filePath: relPath,
    })
  }
  return out
}

export async function updateImageCaption(
  pool: pg.Pool,
  imageId: number,
  caption: string,
): Promise<void> {
  await pool.query(
    `UPDATE metadata_asset_image SET caption = $2 WHERE id = $1`,
    [imageId, caption],
  )
}
