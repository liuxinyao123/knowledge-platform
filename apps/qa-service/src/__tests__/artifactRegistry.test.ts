/**
 * artifactRegistry · N-002 注册表 + 8 类 ArtifactKind
 *
 * 覆盖（按 spec 锁定 scenario）：
 *   - ArtifactKind 8 元 union
 *   - ARTIFACT_REGISTRY 完整性（每个 spec 字段）
 *   - isArtifactKind 守卫
 *   - getArtifactSpec 返回引用
 *   - 8 个 promptTemplate 含 [^N] + 禁词检查
 *   - intent 字段全为 undefined（N-002 不消费）
 *   - slides 用 extended contextStrategy + maxTokens >= 3000
 */
import { describe, it, expect } from 'vitest'
import {
  ARTIFACT_REGISTRY,
  ALL_ARTIFACT_KINDS,
  isArtifactKind,
  getArtifactSpec,
  type ArtifactKind,
} from '../services/artifactGenerator.ts'

describe('ArtifactKind 8 元 union', () => {
  it('包含且仅包含 8 个 kind', () => {
    expect(ALL_ARTIFACT_KINDS).toHaveLength(8)
    const expected: ArtifactKind[] = [
      'briefing', 'faq',
      'mindmap', 'outline', 'timeline',
      'comparison_matrix', 'glossary', 'slides',
    ]
    for (const k of expected) {
      expect(ALL_ARTIFACT_KINDS).toContain(k)
    }
  })
})

describe('ARTIFACT_REGISTRY 完整性', () => {
  for (const kind of ['briefing', 'faq', 'mindmap', 'outline', 'timeline',
                      'comparison_matrix', 'glossary', 'slides'] as const) {
    it(`${kind} spec 字段全部非空`, () => {
      const spec = ARTIFACT_REGISTRY[kind]
      expect(spec).toBeDefined()
      expect(spec.id).toBe(kind)
      expect(spec.label.length).toBeGreaterThan(0)
      expect(spec.icon.length).toBeGreaterThan(0)
      expect(spec.desc.length).toBeGreaterThan(0)
      expect(spec.promptTemplate.length).toBeGreaterThan(100)
      expect(spec.maxTokens).toBeGreaterThanOrEqual(1500)
      expect(spec.maxTokens).toBeLessThanOrEqual(4000)
    })
  }
})

describe('isArtifactKind 守卫', () => {
  it('8 个合法 kind 返回 true', () => {
    for (const k of ALL_ARTIFACT_KINDS) {
      expect(isArtifactKind(k)).toBe(true)
    }
  })
  it('其它字符串 / 非字符串 false', () => {
    expect(isArtifactKind('foo')).toBe(false)
    expect(isArtifactKind('')).toBe(false)
    expect(isArtifactKind('BRIEFING')).toBe(false)  // 大小写敏感
    expect(isArtifactKind(null)).toBe(false)
    expect(isArtifactKind(undefined)).toBe(false)
    expect(isArtifactKind(42)).toBe(false)
    expect(isArtifactKind({})).toBe(false)
  })
})

describe('getArtifactSpec', () => {
  it('返回 ARTIFACT_REGISTRY 中的引用', () => {
    for (const k of ALL_ARTIFACT_KINDS) {
      expect(getArtifactSpec(k)).toBe(ARTIFACT_REGISTRY[k])
    }
  })
})

describe('promptTemplate 字面约束', () => {
  for (const kind of ALL_ARTIFACT_KINDS) {
    it(`${kind} prompt 含 [^N] 引用样式`, () => {
      const spec = ARTIFACT_REGISTRY[kind]
      expect(spec.promptTemplate).toContain('[^N]')
    })
  }

  const FORBIDDEN = ['道德经', '老子', '缓冲块', 'COF', 'B&R', 'Swing', '油漆变差', '铰链公差']
  for (const kind of ALL_ARTIFACT_KINDS) {
    it(`${kind} prompt 不含 hardcoded 文档形态词`, () => {
      const spec = ARTIFACT_REGISTRY[kind]
      for (const w of FORBIDDEN) {
        expect(spec.promptTemplate, `${kind} 含 "${w}"`).not.toContain(w)
      }
    })
  }
})

describe('N-005 intent 字段填值（本 change 已消费）', () => {
  it('所有 spec 的 intent 字段都已填值', () => {
    for (const k of ALL_ARTIFACT_KINDS) {
      expect(ARTIFACT_REGISTRY[k].intent).toBeDefined()
    }
  })
  it('intent 映射符合 N-005 D-002', () => {
    expect(ARTIFACT_REGISTRY.briefing.intent).toBe('language_op')
    expect(ARTIFACT_REGISTRY.faq.intent).toBe('language_op')
    expect(ARTIFACT_REGISTRY.mindmap.intent).toBe('language_op')
    expect(ARTIFACT_REGISTRY.outline.intent).toBe('language_op')
    expect(ARTIFACT_REGISTRY.timeline.intent).toBe('language_op')
    expect(ARTIFACT_REGISTRY.comparison_matrix.intent).toBe('multi_doc_compare')
    expect(ARTIFACT_REGISTRY.glossary.intent).toBe('factual_lookup')
    expect(ARTIFACT_REGISTRY.slides.intent).toBe('language_op')
  })
  it('intent 不取 kb_meta / out_of_scope（artifact 不适用）', () => {
    for (const k of ALL_ARTIFACT_KINDS) {
      expect(ARTIFACT_REGISTRY[k].intent).not.toBe('kb_meta')
      expect(ARTIFACT_REGISTRY[k].intent).not.toBe('out_of_scope')
    }
  })
})

describe('contextStrategy', () => {
  it('slides 用 extended + maxTokens >= 3000', () => {
    const slides = ARTIFACT_REGISTRY.slides
    expect(slides.contextStrategy).toBe('extended')
    expect(slides.maxTokens).toBeGreaterThanOrEqual(3000)
  })
  it('其它 kind 用 default 或 undefined', () => {
    for (const k of ALL_ARTIFACT_KINDS) {
      if (k === 'slides') continue
      const strategy = ARTIFACT_REGISTRY[k].contextStrategy
      expect(strategy === undefined || strategy === 'default').toBe(true)
    }
  })
})
