const L1_CHARS = 3000
const L2_CHARS = 1200
const L3_CHARS = 450

function splitBySize(text: string, maxChars: number): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length)
    if (end < text.length) {
      const boundary = text.lastIndexOf('。', end)
      if (boundary > start + maxChars * 0.5) end = boundary + 1
    }
    const chunk = text.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    start = end
  }
  return chunks
}

export function chunkDocument(text: string): { l1: string[]; l2: string[]; l3: string[] } {
  if (!text.trim()) return { l1: [], l2: [], l3: [] }
  return {
    l1: splitBySize(text, L1_CHARS),
    l2: splitBySize(text, L2_CHARS),
    l3: splitBySize(text, L3_CHARS),
  }
}
