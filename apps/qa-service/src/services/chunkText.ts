/** 固定窗口分块，带重叠，用于索引与向量检索 */
export function chunkText(text: string, chunkSize = 900, overlap = 200): string[] {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return []
  if (t.length <= chunkSize) return [t]

  const step = Math.max(1, chunkSize - overlap)
  const out: string[] = []
  for (let i = 0; i < t.length; i += step) {
    out.push(t.slice(i, i + chunkSize))
    if (i + chunkSize >= t.length) break
  }
  return out
}
