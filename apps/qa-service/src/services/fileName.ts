/**
 * fileName.ts —— multipart 文件名解码兜底
 *
 * 背景：multer 默认把 multipart Content-Disposition 里的 filename 按 latin1 解码
 * 再塞进 `file.originalname`。浏览器上传中文文件名时发的是 UTF-8 字节，
 * 于是前端看到的是 `å°¾é ¨à·¥ç¨...` 这种 UTF-8-as-Latin-1 mojibake。
 *
 * 策略：只在疑似 mojibake（出现 U+0080~U+00FF 范围字符）时，
 * 按 latin1 → utf8 重新解码；若解码结果含 U+FFFD 替换符（说明本来就是 latin1）
 * 则回退到原值。
 *
 * 调用点：
 *   - routes/ingest.ts        (/extract-text, /upload-job)
 *   - routes/knowledgeDocs.ts (/documents)
 *
 * 相关 bug：BUG-xlsx-01（2026-04-24 · Excel 上传文件名乱码 + 0 chunks）
 */
export function decodeUploadedFilename(name: string | undefined | null): string {
  if (!name) return name ?? ''
  // 没有高位字节 → 纯 ASCII，无需处理
  // eslint-disable-next-line no-control-regex
  if (!/[\u0080-\u00ff]/.test(name)) return name
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8')
    // 解码结果含替换符 = 原本就是合法 latin1 文件名，不要破坏它
    if (fixed.includes('\ufffd')) return name
    return fixed
  } catch {
    return name
  }
}
