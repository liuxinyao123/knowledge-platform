/**
 * fileName.test.ts —— multipart 文件名解码
 * 相关 bug：BUG-xlsx-01（2026-04-24 · Excel 上传文件名乱码）
 */
import { describe, it, expect } from 'vitest'
import { decodeUploadedFilename } from '../services/fileName.ts'

describe('decodeUploadedFilename', () => {
  it('returns ASCII names unchanged', () => {
    expect(decodeUploadedFilename('report.pdf')).toBe('report.pdf')
    expect(decodeUploadedFilename('My_Doc-2026 V2.xlsx')).toBe('My_Doc-2026 V2.xlsx')
  })

  it('decodes UTF-8-as-latin1 mojibake back to UTF-8', () => {
    // 中文"尾门" 的 UTF-8 字节是 E5 B0 BE E9 97 A8
    // multer 按 latin1 解码后得到 `å°¾é—¨`（U+00E5 U+00B0 U+00BE U+00E9 U+2014 U+00A8）
    // 构造一个 latin1 原始字符串再验证解码
    const utf8Bytes = Buffer.from('尾门总成.xlsx', 'utf8')
    const mojibake = utf8Bytes.toString('latin1')
    expect(decodeUploadedFilename(mojibake)).toBe('尾门总成.xlsx')
  })

  it('preserves legitimate latin1 names when UTF-8 decode would corrupt', () => {
    // 合法的 latin1 文件名 "café.pdf"（单字节 0xE9）不是 UTF-8 开头字节
    // latin1→utf8 解码会产生 U+FFFD，触发 guard 回退
    const latin1Name = 'caf\u00e9.pdf' // "café.pdf"
    const result = decodeUploadedFilename(latin1Name)
    // 解码失败 → 返回原值
    expect(result).toBe(latin1Name)
  })

  it('handles empty / null / undefined', () => {
    expect(decodeUploadedFilename('')).toBe('')
    expect(decodeUploadedFilename(undefined)).toBe('')
    expect(decodeUploadedFilename(null)).toBe('')
  })
})
