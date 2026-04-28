/**
 * adaptiveTopK · 按问题特征选 top-K
 *
 * 覆盖：
 *   1. 英文大写缩写题 → 5
 *   2. 中文短查询（≤6 字）→ 8
 *   3. 复合查询（含信号词）→ 15
 *   4. 默认 → 10
 *   5. 边界：空字符串 / 仅空白 / 标点
 *   6. 缩写题优先于"短查询"判断（"COF"5 字符也是英文缩写 → 5 而非 8）
 */
import { describe, it, expect } from 'vitest'
import { adaptiveTopK } from '../services/ragPipeline.ts'

describe('adaptiveTopK', () => {
  describe('英文大写缩写题 → K=5', () => {
    it('"API"', () => expect(adaptiveTopK('API')).toBe(5))
    it('"COF"', () => expect(adaptiveTopK('COF')).toBe(5))
    it('"B2B"', () => expect(adaptiveTopK('B2B')).toBe(5))
    it('"REST?"', () => expect(adaptiveTopK('REST?')).toBe(5))
    it('"OAUTH2"', () => expect(adaptiveTopK('OAUTH2')).toBe(5))
    it('带连字符的缩写 "B-2-B"', () => expect(adaptiveTopK('B-2-B')).toBe(5))
  })

  describe('中文短查询（≤6 字符）→ K=8（C 调优：之前是 5，太窄）', () => {
    it('"什么是道？"（5 字符）', () => expect(adaptiveTopK('什么是道？')).toBe(8))
    it('"缓冲块"（3 字符）', () => expect(adaptiveTopK('缓冲块')).toBe(8))
    it('"原文"（2 字符）', () => expect(adaptiveTopK('原文')).toBe(8))
    it('"老子的思想"（5 字符）', () => expect(adaptiveTopK('老子的思想')).toBe(8))
    it('正好 6 字符 "道德经第一章"', () => expect(adaptiveTopK('道德经第一章')).toBe(8))
    it('7 字符就走默认 "道德经第一章节" → 10', () => expect(adaptiveTopK('道德经第一章节')).toBe(10))
  })

  describe('复合查询 → K=15', () => {
    it('"X 和 Y 的区别"', () => expect(adaptiveTopK('CORS 和 CSRF 的区别是什么')).toBe(15))
    it('"分别是什么"', () => expect(adaptiveTopK('道德经的两个核心概念分别是什么')).toBe(15))
    it('"对比一下"', () => expect(adaptiveTopK('对比一下儒家和道家的核心主张')).toBe(15))
    it('英文 "compare A and B"', () => {
      // "compare" 命中复合 marker 但同时长度 > 6，所以走复合分支
      expect(adaptiveTopK('compare REST and GraphQL APIs')).toBe(15)
    })
    it('"哪些步骤"', () => expect(adaptiveTopK('部署的具体步骤是哪些')).toBe(15))
  })

  describe('默认 → K=10', () => {
    it('一般中文问题', () => expect(adaptiveTopK('道德经的作者是谁呢')).toBe(10))
    it('一般英文问题', () => expect(adaptiveTopK('who wrote tao te ching exactly')).toBe(10))
    it('单个具体名词查询', () => expect(adaptiveTopK('请告诉我什么是依赖注入')).toBe(10))
  })

  describe('优先级 / 边界', () => {
    it('英文缩写优先于短查询：5 字符的"COF" 走 5（不走 8）', () => {
      expect(adaptiveTopK('COF')).toBe(5)
    })
    it('混合中英文短查询走中文短查询分支：4 字符的"老子 API" 是 6 字 → 8', () => {
      // "老子 API" 是 6 字符（含空格），不是纯英文缩写正则不匹配 → 走 length<=6 → 8
      expect(adaptiveTopK('老子 API')).toBe(8)
    })
    it('空字符串', () => expect(adaptiveTopK('')).toBe(8))
    it('仅空白 trim 后为空', () => expect(adaptiveTopK('   ')).toBe(8))
    it('首尾空白被 trim', () => expect(adaptiveTopK('  缓冲块  ')).toBe(8))
  })
})
