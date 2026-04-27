import { describe, it, expect } from 'vitest'
import {
  looksLikeOcrFragment, looksLikeErrorJsonBlob, isBadChunk, MIN_CHUNK_CHARS,
} from '../services/textHygiene.ts'

describe('looksLikeOcrFragment', () => {
  it('含 emoji 判为碎片', () => {
    expect(looksLikeOcrFragment('🎯 foo')).toBe(true)
    expect(looksLikeOcrFragment('normal text')).toBe(false)
  })

  it('含裸引号判为碎片', () => {
    expect(looksLikeOcrFragment('alpha " beta')).toBe(true)
    expect(looksLikeOcrFragment(`it's`)).toBe(true)
  })

  it('"g g g" 型（单字母堆叠）判为碎片', () => {
    expect(looksLikeOcrFragment('g g g')).toBe(true)
    expect(looksLikeOcrFragment('G G G D')).toBe(true)
    expect(looksLikeOcrFragment('a b c d e')).toBe(true)
  })

  it('token 平均长度 ≥ 2 不判为碎片', () => {
    expect(looksLikeOcrFragment('GG DD FF')).toBe(false)
    expect(looksLikeOcrFragment('RAG pipeline')).toBe(false)
  })

  it('中文短语不误杀', () => {
    expect(looksLikeOcrFragment('知识图谱')).toBe(false)
    expect(looksLikeOcrFragment('机器学习算法')).toBe(false)
  })

  it('英文正常短语不误杀', () => {
    expect(looksLikeOcrFragment('machine learning')).toBe(false)
    expect(looksLikeOcrFragment('Knowledge Graph')).toBe(false)
  })
})

describe('looksLikeErrorJsonBlob', () => {
  it('识别 type:error', () => {
    expect(looksLikeErrorJsonBlob('{"type":"error","error":{"message":"boom"}}')).toBe(true)
  })

  it('识别 not_found_error', () => {
    expect(looksLikeErrorJsonBlob('{"error":{"type":"not_found_error"}}')).toBe(true)
  })

  it('识别 File not found in container', () => {
    expect(looksLikeErrorJsonBlob('{"msg":"File not found in container: /mnt/foo.md"}')).toBe(true)
  })

  it('非 JSON 顶层开头不算', () => {
    expect(looksLikeErrorJsonBlob('prefix {"error":{...}}')).toBe(false)
    expect(looksLikeErrorJsonBlob('plain text')).toBe(false)
    expect(looksLikeErrorJsonBlob('')).toBe(false)
  })

  it('正常 JSON 不误伤', () => {
    expect(looksLikeErrorJsonBlob('{"status":"ok","data":[]}')).toBe(false)
    // 注意：`"error":"validation_failed"`（字符串值）不算，因为规则要求 error:{} object
    expect(looksLikeErrorJsonBlob('{"error":"validation_failed"}')).toBe(false)
  })
})

describe('isBadChunk', () => {
  it('太短 → too_short', () => {
    expect(isBadChunk('abc')).toEqual({ bad: true, reason: 'too_short' })
    expect(isBadChunk('   ')).toEqual({ bad: true, reason: 'too_short' })
    expect(isBadChunk(null)).toEqual({ bad: true, reason: 'too_short' })
    expect(isBadChunk(undefined)).toEqual({ bad: true, reason: 'too_short' })
  })

  it('error JSON → error_json_blob', () => {
    const s = '{"type":"error","error":{"message":"File not found in container: /mnt/foo"}}'
    expect(isBadChunk(s)).toEqual({ bad: true, reason: 'error_json_blob' })
  })

  it('OCR 碎片 → ocr_fragment（长度足够但模式碎）', () => {
    // 长度必须 ≥ MIN_CHUNK_CHARS 才能进 OCR 判断
    const long = 'BumperOrallyD G G G G G G G G G G'  // >= 20 chars
    expect(long.length).toBeGreaterThanOrEqual(MIN_CHUNK_CHARS)
    expect(isBadChunk(long)).toEqual({ bad: true, reason: 'ocr_fragment' })
  })

  it('正常正文 → ok', () => {
    expect(isBadChunk('知识图谱是一种语义网络，用节点表示实体和边表示实体间的关系。'))
      .toEqual({ bad: false })
    expect(isBadChunk('Knowledge Graph is a network structure that represents entities as nodes.'))
      .toEqual({ bad: false })
  })

  it('太短 + emoji → 仍报 too_short（优先级先判长度）', () => {
    expect(isBadChunk('🎯')).toEqual({ bad: true, reason: 'too_short' })
  })
})
