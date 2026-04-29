/**
 * notebookTemplates · N-006 注册表完整性 + 守卫 + 跟 N-002 ARTIFACT_REGISTRY 对接
 */
import { describe, it, expect } from 'vitest'
import {
  NOTEBOOK_TEMPLATES,
  ALL_NOTEBOOK_TEMPLATE_IDS,
  isNotebookTemplateId,
  getNotebookTemplate,
  validateNotebookTemplatesRegistry,
  type NotebookTemplateId,
} from '../services/notebookTemplates.ts'
import { isArtifactKind } from '../services/artifactGenerator.ts'

describe('NotebookTemplateId 6 元 union', () => {
  it('包含且仅包含 6 个 id', () => {
    expect(ALL_NOTEBOOK_TEMPLATE_IDS).toHaveLength(6)
    const expected: NotebookTemplateId[] = [
      'research_review', 'meeting_prep', 'competitive_analysis',
      'learning_aid', 'project_retrospective', 'translation_explain',
    ]
    for (const id of expected) {
      expect(ALL_NOTEBOOK_TEMPLATE_IDS).toContain(id)
    }
  })
})

describe('NOTEBOOK_TEMPLATES 完整性', () => {
  for (const id of ['research_review', 'meeting_prep', 'competitive_analysis',
                    'learning_aid', 'project_retrospective', 'translation_explain'] as const) {
    it(`${id} spec 字段全部满足约束`, () => {
      const spec = NOTEBOOK_TEMPLATES[id]
      expect(spec).toBeDefined()
      expect(spec.id).toBe(id)
      expect(spec.label.length).toBeGreaterThan(0)
      expect(spec.label.length).toBeLessThanOrEqual(10)
      expect(spec.icon.length).toBeGreaterThan(0)
      expect(spec.desc.length).toBeGreaterThan(0)
      expect(spec.desc.length).toBeLessThanOrEqual(60)
      expect(spec.recommendedSourceHint.length).toBeGreaterThan(0)
      expect(spec.recommendedSourceHint.length).toBeLessThanOrEqual(40)
      expect(Array.isArray(spec.recommendedArtifactKinds)).toBe(true)
      expect(Array.isArray(spec.starterQuestions)).toBe(true)
      expect(spec.starterQuestions.length).toBeGreaterThanOrEqual(1)
      for (const q of spec.starterQuestions) {
        expect(q.length).toBeLessThanOrEqual(50)
      }
    })
  }
})

describe('recommendedArtifactKinds 引用合法 ArtifactKind', () => {
  for (const id of ALL_NOTEBOOK_TEMPLATE_IDS) {
    it(`${id} 全部引用合法`, () => {
      const spec = NOTEBOOK_TEMPLATES[id]
      for (const k of spec.recommendedArtifactKinds) {
        expect(isArtifactKind(k), `${id} 含非法 ArtifactKind: ${k}`).toBe(true)
      }
    })
  }
})

describe('isNotebookTemplateId 守卫', () => {
  it('6 合法 id 返回 true', () => {
    for (const id of ALL_NOTEBOOK_TEMPLATE_IDS) {
      expect(isNotebookTemplateId(id)).toBe(true)
    }
  })
  it('其它字符串 / 非字符串 false', () => {
    expect(isNotebookTemplateId('foo')).toBe(false)
    expect(isNotebookTemplateId('')).toBe(false)
    expect(isNotebookTemplateId('RESEARCH_REVIEW')).toBe(false) // 大小写敏感
    expect(isNotebookTemplateId(null)).toBe(false)
    expect(isNotebookTemplateId(undefined)).toBe(false)
    expect(isNotebookTemplateId(42)).toBe(false)
    expect(isNotebookTemplateId({})).toBe(false)
  })
})

describe('getNotebookTemplate', () => {
  it('返回 NOTEBOOK_TEMPLATES 引用', () => {
    for (const id of ALL_NOTEBOOK_TEMPLATE_IDS) {
      expect(getNotebookTemplate(id)).toBe(NOTEBOOK_TEMPLATES[id])
    }
  })
})

describe('字面期望（关键映射 freeze）', () => {
  it('label / icon / recommendedArtifactKinds 跟 design.md 一致', () => {
    expect(NOTEBOOK_TEMPLATES.research_review.label).toBe('研究综述')
    expect(NOTEBOOK_TEMPLATES.research_review.icon).toBe('🔬')
    expect(NOTEBOOK_TEMPLATES.research_review.recommendedArtifactKinds)
      .toEqual(['briefing', 'faq', 'glossary'])

    expect(NOTEBOOK_TEMPLATES.meeting_prep.label).toBe('会议准备')
    expect(NOTEBOOK_TEMPLATES.meeting_prep.icon).toBe('🎤')
    expect(NOTEBOOK_TEMPLATES.meeting_prep.recommendedArtifactKinds)
      .toEqual(['outline', 'slides', 'briefing'])

    expect(NOTEBOOK_TEMPLATES.competitive_analysis.label).toBe('竞品分析')
    expect(NOTEBOOK_TEMPLATES.competitive_analysis.icon).toBe('📊')
    expect(NOTEBOOK_TEMPLATES.competitive_analysis.recommendedArtifactKinds)
      .toEqual(['comparison_matrix', 'briefing'])

    expect(NOTEBOOK_TEMPLATES.learning_aid.label).toBe('学习辅助')
    expect(NOTEBOOK_TEMPLATES.learning_aid.icon).toBe('📚')
    expect(NOTEBOOK_TEMPLATES.learning_aid.recommendedArtifactKinds)
      .toEqual(['mindmap', 'outline', 'glossary'])

    expect(NOTEBOOK_TEMPLATES.project_retrospective.label).toBe('项目复盘')
    expect(NOTEBOOK_TEMPLATES.project_retrospective.icon).toBe('⏱️')
    expect(NOTEBOOK_TEMPLATES.project_retrospective.recommendedArtifactKinds)
      .toEqual(['timeline', 'briefing', 'faq'])

    expect(NOTEBOOK_TEMPLATES.translation_explain.label).toBe('翻译/解释')
    expect(NOTEBOOK_TEMPLATES.translation_explain.icon).toBe('🌐')
    expect(NOTEBOOK_TEMPLATES.translation_explain.recommendedArtifactKinds)
      .toEqual([])  // 翻译类不预设 artifact
  })
})

describe('validateNotebookTemplatesRegistry', () => {
  it('整个注册表通过校验', () => {
    const r = validateNotebookTemplatesRegistry()
    if (!r.ok) {
      console.error('Registry validation errors:', r.errors)
    }
    expect(r.ok).toBe(true)
  })
})
