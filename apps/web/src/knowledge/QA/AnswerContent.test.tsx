/**
 * ADR-45 · AnswerContent 单测
 *
 * 验证 parseAnswerSegments 的切分 + 安全 URL allow-list：
 *   - 纯文本 → 1 段 text
 *   - 单图 → text + img + text
 *   - 多图 → 3+ 段交替
 *   - 流式半截（无闭合 ")"）→ 整段 text，不抢解析
 *   - 非 /api/assets/images/\\d+ URL（含外部 / data: / javascript: / 非数字 id）→ 退化为 text 字面量（防 XSS）
 *   - alt 空字符串 → 段保留
 */

import { describe, it, expect } from 'vitest'
import { parseAnswerSegments, SAFE_IMAGE_URL_PATTERN_FOR_TEST } from './AnswerContent'

describe('parseAnswerSegments — 切分 + URL 校验', () => {
  it('空输入 → 空数组', () => {
    expect(parseAnswerSegments('')).toEqual([])
  })

  it('纯文本无 markdown → 单 text 段', () => {
    expect(parseAnswerSegments('hello world')).toEqual([
      { kind: 'text', text: 'hello world' },
    ])
  })

  it('单张合法图 → text + img + text', () => {
    const out = parseAnswerSegments('7° [1] ![diagram](/api/assets/images/42) 见上图')
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ kind: 'text', text: '7° [1] ' })
    expect(out[1]).toEqual({ kind: 'img', alt: 'diagram', url: '/api/assets/images/42' })
    expect(out[2]).toEqual({ kind: 'text', text: ' 见上图' })
  })

  it('多张图夹文字 → 段顺序保留', () => {
    const out = parseAnswerSegments(
      '![](/api/assets/images/1) middle ![](/api/assets/images/2)',
    )
    expect(out.map((s) => s.kind)).toEqual(['img', 'text', 'img'])
    expect(out[0]).toEqual({ kind: 'img', alt: '', url: '/api/assets/images/1' })
    expect(out[1]).toEqual({ kind: 'text', text: ' middle ' })
    expect(out[2]).toEqual({ kind: 'img', alt: '', url: '/api/assets/images/2' })
  })

  it('流式半截 markdown（缺 ")"）不抢解析', () => {
    const out = parseAnswerSegments('answer is 7° ![diagram](/api/assets/images/42')
    // regex 不匹配未闭合，整段当 text
    expect(out).toEqual([
      { kind: 'text', text: 'answer is 7° ![diagram](/api/assets/images/42' },
    ])
  })

  it('XSS · javascript: → 退化为 raw text', () => {
    const out = parseAnswerSegments('![evil](javascript:alert(1))')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('text')
    expect(out[0].text).toContain('javascript:')
  })

  it('XSS · data: 协议 → 退化为 raw text', () => {
    const out = parseAnswerSegments('![](data:text/html,<script>alert(1)</script>)')
    expect(out[0].kind).toBe('text')
  })

  it('外部 URL → 退化为 raw text', () => {
    const out = parseAnswerSegments('![](https://evil.com/spy.png)')
    expect(out[0].kind).toBe('text')
    expect(out[0].text).toBe('![](https://evil.com/spy.png)')
  })

  it('内部 URL 但 id 非数字 → 退化为 raw text', () => {
    const out = parseAnswerSegments('![](/api/assets/images/abc)')
    expect(out[0].kind).toBe('text')
  })

  it('内部 URL 但 id 后多了路径 → 退化为 raw text（防 path traversal）', () => {
    const out = parseAnswerSegments('![](/api/assets/images/42/../../etc/passwd)')
    // SAFE_IMAGE_URL_RE 是严格 ^/api/assets/images/\\d+$，多任何字符都不过
    expect(out[0].kind).toBe('text')
  })

  it('SAFE_IMAGE_URL_RE · 数字 id 通过', () => {
    expect(SAFE_IMAGE_URL_PATTERN_FOR_TEST.test('/api/assets/images/0')).toBe(true)
    expect(SAFE_IMAGE_URL_PATTERN_FOR_TEST.test('/api/assets/images/12345')).toBe(true)
  })

  it('SAFE_IMAGE_URL_RE · 任何 query / fragment / 末尾斜杠都不过', () => {
    expect(SAFE_IMAGE_URL_PATTERN_FOR_TEST.test('/api/assets/images/42?xss=1')).toBe(false)
    expect(SAFE_IMAGE_URL_PATTERN_FOR_TEST.test('/api/assets/images/42#a')).toBe(false)
    expect(SAFE_IMAGE_URL_PATTERN_FOR_TEST.test('/api/assets/images/42/')).toBe(false)
    expect(SAFE_IMAGE_URL_PATTERN_FOR_TEST.test('/api/assets/images/42 ')).toBe(false)
  })

  it('alt 空字符串 → 段保留 alt=""', () => {
    const out = parseAnswerSegments('![](/api/assets/images/7)')
    expect(out[0]).toEqual({ kind: 'img', alt: '', url: '/api/assets/images/7' })
  })

  it('全图无文字 → 单 img 段', () => {
    const out = parseAnswerSegments('![cap](/api/assets/images/9)')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('img')
  })

  it('regex 状态机 reset：连跑两次同输入，结果一致', () => {
    const a = parseAnswerSegments('![](/api/assets/images/1)')
    const b = parseAnswerSegments('![](/api/assets/images/1)')
    expect(a).toEqual(b)
  })
})
