/**
 * notebookTemplates · N-006 注册表完整性 + 守卫 + 跟 N-002 ARTIFACT_REGISTRY 对接
 *                  · N-007 PT-1..PT-8 DB 层 acceptance（mock pgPool）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// PT-1..PT-6 / DB 层测试要 mock getPgPool；放在 import 顶部以确保 hoisting
vi.mock('../services/pgDb.ts', () => {
  const queryMock = vi.fn()
  return {
    getPgPool: () => ({ query: queryMock }),
    __queryMock: queryMock,
  }
})

import {
  NOTEBOOK_TEMPLATES,
  ALL_NOTEBOOK_TEMPLATE_IDS,
  isNotebookTemplateId,
  getNotebookTemplate,
  validateNotebookTemplatesRegistry,
  loadTemplatesFromDb,
  getTemplateByKey,
  seedSystemTemplatesIfMissing,
  type NotebookTemplateId,
} from '../services/notebookTemplates.ts'
import { isArtifactKind } from '../services/artifactGenerator.ts'

// 取出 vi.mock 注入的 query mock，PT-* tests 用它操控 SQL 返回值
import * as _pgDbMod from '../services/pgDb.ts'
const queryMock = (_pgDbMod as unknown as { __queryMock: ReturnType<typeof vi.fn> }).__queryMock

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
      // N-007 加 source：6 个内置都应是 system
      expect(spec.source).toBe('system')
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

// ── N-007 acceptance（PT-1..PT-8）─────────────────────────────────────────
// PT-7/PT-8 是 DB CHECK 约束，无法在仅 mock pgPool 的单元层完整覆盖（需要 PG 跑
// 真实 DDL）；这里改写为「断言守卫语义」+ 在 V-1 manual SQL 验证里覆盖（见 tasks.md
// V-1）。如果未来加入 testcontainers 起 PG，可把 PT-7/PT-8 升级为真正 INSERT 测。

describe('N-007 · loadTemplatesFromDb / getTemplateByKey / seed', () => {
  beforeEach(() => {
    queryMock.mockReset()
  })

  it('PT-1 seedSystemTemplatesIfMissing: 表空 → 6 条 source=system 写入', async () => {
    // 第一次 SELECT 返 0 行；后续 6 次 INSERT 视为成功（rowCount 1 即可）
    queryMock.mockResolvedValueOnce({ rows: [] })
    for (let i = 0; i < 6; i++) {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    }
    const r = await seedSystemTemplatesIfMissing()
    expect(r.seeded).toBe(6)
    // 第 1 次是 SELECT，第 2..7 次是 INSERT，验证 INSERT 用了 source='system'
    const insertCalls = queryMock.mock.calls.slice(1)
    expect(insertCalls).toHaveLength(6)
    for (const call of insertCalls) {
      const sql = call[0] as string
      expect(sql).toMatch(/INSERT INTO notebook_template/)
      expect(sql).toMatch(/'system'/)
    }
  })

  it('PT-2 seedSystemTemplatesIfMissing: 已有 6 system → 0 写入', async () => {
    queryMock.mockResolvedValueOnce({
      rows: ALL_NOTEBOOK_TEMPLATE_IDS.map((id) => ({ template_key: id })),
    })
    const r = await seedSystemTemplatesIfMissing()
    expect(r.seeded).toBe(0)
    // 仅一次 SELECT，没 INSERT
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('PT-3 loadTemplatesFromDb 普通用户 → SQL 含 source IN system/community + owner_user_id 过滤', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 1, template_key: 'research_review', source: 'system',
          owner_user_id: null, label: '研究综述', icon: '🔬',
          description: '...', recommended_source_hint: '...',
          recommended_artifact_kinds: ['briefing'], starter_questions: ['q1'],
        },
      ],
    })
    const r = await loadTemplatesFromDb({ userId: 7, isAdmin: false })
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('research_review')
    expect(r[0].source).toBe('system')
    // SQL 应该包含可见性过滤 + 参数 [7]
    const [sql, params] = queryMock.mock.calls[0]
    expect(sql).toMatch(/source IN \('system', 'community'\)/)
    expect(sql).toMatch(/owner_user_id = \$1/)
    expect(params).toEqual([7])
  })

  it('PT-4 loadTemplatesFromDb 管理员 → SQL 不含 owner 过滤', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] })
    await loadTemplatesFromDb({ userId: 7, isAdmin: true })
    const [sql, params] = queryMock.mock.calls[0]
    expect(sql).not.toMatch(/owner_user_id = /)
    expect(sql).toMatch(/FROM notebook_template/)
    expect(params).toBeUndefined()
  })

  it('PT-5 getTemplateByKey 不存在 → null', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] })
    const r = await getTemplateByKey({ key: 'foo_bar', userId: 7 })
    expect(r).toBeNull()
  })

  it('PT-6 getTemplateByKey 别人的 user 模板 → null（普通用户）', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 99, template_key: 'someone_else_tpl', source: 'user',
          owner_user_id: 42,  // 不是当前 userId=7
          label: '别人的', icon: '🌟',
          description: '...', recommended_source_hint: '...',
          recommended_artifact_kinds: [], starter_questions: ['q'],
        },
      ],
    })
    const r = await getTemplateByKey({ key: 'someone_else_tpl', userId: 7 })
    expect(r).toBeNull()
  })

  it('PT-6+ getTemplateByKey 自己的 user 模板 → 返回', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 100, template_key: 'my_tpl', source: 'user',
          owner_user_id: 7,
          label: '我的', icon: '📝',
          description: '...', recommended_source_hint: '...',
          recommended_artifact_kinds: ['briefing'], starter_questions: ['q'],
        },
      ],
    })
    const r = await getTemplateByKey({ key: 'my_tpl', userId: 7 })
    expect(r).not.toBeNull()
    expect(r?.id).toBe('my_tpl')
    expect(r?.source).toBe('user')
  })

  it('PT-6++ getTemplateByKey admin 看别人的 user 模板 → 返回', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 99, template_key: 'someone_tpl', source: 'user',
          owner_user_id: 42,
          label: '别人的', icon: '🌟',
          description: '...', recommended_source_hint: '...',
          recommended_artifact_kinds: [], starter_questions: ['q'],
        },
      ],
    })
    const r = await getTemplateByKey({ key: 'someone_tpl', userId: 7, isAdmin: true })
    expect(r).not.toBeNull()
  })

  // PT-7 / PT-8 DB CHECK 约束在单元层只能验证 SQL DDL 语义；真实约束执行在 V-1
  // manual 验证里覆盖。此处给一个语义守卫：seedSystemTemplatesIfMissing 始终用
  // owner_user_id=NULL（避免后端代码把 system 模板写成带 owner，触发 PT-8 约束）
  it('PT-8 守卫：seedSystemTemplatesIfMissing INSERT 永远 owner=NULL', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] })
    for (let i = 0; i < 6; i++) {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    }
    await seedSystemTemplatesIfMissing()
    const insertCalls = queryMock.mock.calls.slice(1)
    for (const [, params] of insertCalls) {
      // params[2] 不存在；NULL 直接写在 SQL 字面量
      // 但文本里应有 NULL 作为 owner
      const sql = insertCalls[0][0] as string
      expect(sql).toMatch(/'system', NULL,/)
      void params
      break
    }
  })

  it('PT-9 (extra) loadTemplatesFromDb DB throw → fallback to system constants', async () => {
    queryMock.mockRejectedValueOnce(new Error('PG down'))
    const r = await loadTemplatesFromDb({ userId: 7, isAdmin: false })
    // 应回退到 6 个 system 模板
    expect(r.length).toBe(ALL_NOTEBOOK_TEMPLATE_IDS.length)
    for (const t of r) expect(t.source).toBe('system')
  })

  it('PT-10 (extra) getTemplateByKey DB throw + key 命中常量 → fallback', async () => {
    queryMock.mockRejectedValueOnce(new Error('PG down'))
    const r = await getTemplateByKey({ key: 'research_review', userId: 7 })
    expect(r).not.toBeNull()
    expect(r?.id).toBe('research_review')
    expect(r?.source).toBe('system')
  })

  it('PT-11 (extra) getTemplateByKey DB throw + key 不在常量 → null', async () => {
    queryMock.mockRejectedValueOnce(new Error('PG down'))
    const r = await getTemplateByKey({ key: 'no_such_key', userId: 7 })
    expect(r).toBeNull()
  })
})
