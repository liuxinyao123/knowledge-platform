/**
 * services/notebookTemplates.ts —— Notebook 模板系统（N-006 → N-007 → N-008）
 *
 * 6 个内置模板（研究综述 / 会议准备 / 竞品分析 / 学习辅助 / 项目复盘 / 翻译解释），
 * 每个模板承载：场景说明 + 推荐 sources 类型 + 推荐 artifact 套件（复用 N-002
 * ARTIFACT_REGISTRY）+ 推荐起手提问。
 *
 * 设计原则：
 *   - 模板 = 配置（不是自动化）：用户保留控制权，模板只是 UI 引导
 *   - N-006：模板内容存代码注册表，DB 只存 template_id
 *   - N-007：把模板搬到 DB 表 notebook_template；source = system | community | user
 *           用于支持 N-008 用户自定义模板。代码常量保留作 seed 数据源 + 类型 narrowing
 *   - N-008：开放用户自定义模板 CRUD；source='user' + owner_user_id 限定可见性；
 *           不级联清空 notebook.template_id（dangling reference 由前端 graceful handle）
 *   - 提示卡可 dismiss（前端 localStorage 记忆）
 *
 * 详见：
 *   - openspec/changes/notebook-public-templates/...（N-007）
 *   - openspec/changes/notebook-user-templates/...（N-008）
 *   - apps/qa-service/src/migrations/002-notebook-template-table.sql
 */
import { randomBytes } from 'node:crypto'
import type { ArtifactKind } from './artifactGenerator.ts'
import { isArtifactKind } from './artifactGenerator.ts'
import { getPgPool } from './pgDb.ts'

// ── 类型 ─────────────────────────────────────────────────────────────────────

/**
 * N-006 起的 6 个内置 system 模板的便捷字面量类型。
 * N-007 把 `NotebookTemplateSpec.id` 从此 union widening 到 `string`，以容纳
 * community / user 模板的任意 key；本类型仍保留作 system 模板的类型 narrowing。
 */
export type NotebookTemplateId =
  | 'research_review'
  | 'meeting_prep'
  | 'competitive_analysis'
  | 'learning_aid'
  | 'project_retrospective'
  | 'translation_explain'

/** N-007：模板来源 */
export type NotebookTemplateSource = 'system' | 'community' | 'user'

export interface NotebookTemplateSpec {
  /** N-006: NotebookTemplateId 字面量；N-007 widening 到 string 以容纳 user / community 模板 key */
  id: string
  /** N-007 新增：标记模板来源 */
  source: NotebookTemplateSource
  label: string                              // 中文展示名（≤ 10 字）
  icon: string                               // emoji
  desc: string                               // 用户看的简介（≤ 60 字）
  recommendedSourceHint: string              // 推荐 sources 引导（≤ 40 字）
  recommendedArtifactKinds: ArtifactKind[]   // 0-3 个推荐 artifact
  starterQuestions: string[]                 // 1-3 条推荐起手提问（每条 ≤ 50 字）
}

// ── 注册表 ───────────────────────────────────────────────────────────────────

export const NOTEBOOK_TEMPLATES: Record<NotebookTemplateId, NotebookTemplateSpec> = {
  research_review: {
    id: 'research_review',
    source: 'system',
    label: '研究综述',
    icon: '🔬',
    desc: '分析多份学术论文 / 行业报告，提炼共识与分歧、关键数据',
    recommendedSourceHint: '上传 ≥ 2 份论文 / 报告',
    recommendedArtifactKinds: ['briefing', 'faq', 'glossary'],
    starterQuestions: [
      '这些资料的核心论点是什么',
      '不同资料之间的共识与分歧',
      '列出关键术语和定义',
    ],
  },
  meeting_prep: {
    id: 'meeting_prep',
    source: 'system',
    label: '会议准备',
    icon: '🎤',
    desc: '基于若干背景文档准备会议讨论提纲、汇报材料',
    recommendedSourceHint: '上传议程 / 背景资料 / 上次纪要',
    recommendedArtifactKinds: ['outline', 'slides', 'briefing'],
    starterQuestions: [
      '这次会议要讨论的关键点',
      '准备一个 5 分钟陈述大纲',
      '可能被问到的问题与回答',
    ],
  },
  competitive_analysis: {
    id: 'competitive_analysis',
    source: 'system',
    label: '竞品分析',
    icon: '📊',
    desc: '对比多份竞品资料的差异和取舍，输出对比矩阵',
    recommendedSourceHint: '上传 ≥ 2 份竞品介绍 / 评测报告',
    recommendedArtifactKinds: ['comparison_matrix', 'briefing'],
    starterQuestions: [
      '这些方案的差异和取舍',
      '对比关键指标（价格 / 性能 / 适用场景）',
      '各方案的优劣势总结',
    ],
  },
  learning_aid: {
    id: 'learning_aid',
    source: 'system',
    label: '学习辅助',
    icon: '📚',
    desc: '梳理一本书 / 一门课的知识结构，建立心智模型',
    recommendedSourceHint: '上传教材 / 课件 / 笔记',
    recommendedArtifactKinds: ['mindmap', 'outline', 'glossary'],
    starterQuestions: [
      '梳理这门课的核心知识结构',
      '列出重点术语与定义',
      '本章的考点和难点',
    ],
  },
  project_retrospective: {
    id: 'project_retrospective',
    source: 'system',
    label: '项目复盘',
    icon: '⏱️',
    desc: '梳理项目时间线 / 决策节点 / 经验教训，沉淀复盘文档',
    recommendedSourceHint: '上传项目文档 / 会议纪要 / 时间记录',
    recommendedArtifactKinds: ['timeline', 'briefing', 'faq'],
    starterQuestions: [
      '项目的关键节点和决策',
      '复盘成功因素和踩过的坑',
      '下次类似项目的改进建议',
    ],
  },
  translation_explain: {
    id: 'translation_explain',
    source: 'system',
    label: '翻译/解释',
    icon: '🌐',
    desc: '上传外文 / 古文资料，做翻译 / 白话解释 / 释义',
    recommendedSourceHint: '上传外文资料 / 古文文档',
    recommendedArtifactKinds: [],   // 翻译类不预设 artifact，靠 chat 即时翻译
    starterQuestions: [
      '把第一章翻译成中文',
      '用白话解释这段',
      '提取关键术语并翻译',
    ],
  },
}

export const ALL_NOTEBOOK_TEMPLATE_IDS: readonly NotebookTemplateId[] =
  Object.keys(NOTEBOOK_TEMPLATES) as NotebookTemplateId[]

export function isNotebookTemplateId(s: unknown): s is NotebookTemplateId {
  return typeof s === 'string' &&
    (ALL_NOTEBOOK_TEMPLATE_IDS as readonly string[]).includes(s)
}

export function getNotebookTemplate(id: NotebookTemplateId): NotebookTemplateSpec {
  return NOTEBOOK_TEMPLATES[id]
}

/**
 * 校验注册表完整性（启动时可调用，确保 recommendedArtifactKinds 都引用合法 ArtifactKind）。
 * 仅供单测和启动时 sanity check 用。
 */
export function validateNotebookTemplatesRegistry(): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  for (const id of ALL_NOTEBOOK_TEMPLATE_IDS) {
    const spec = NOTEBOOK_TEMPLATES[id]
    if (!spec) { errors.push(`missing spec for ${id}`); continue }
    if (spec.id !== id) errors.push(`${id} spec.id mismatch: ${spec.id}`)
    if (spec.source !== 'system') errors.push(`${id} 应是 source=system 内置模板，实际 source=${spec.source}`)
    if (!spec.label || spec.label.length === 0) errors.push(`${id} label empty`)
    if (spec.label.length > 10) errors.push(`${id} label too long`)
    if (!spec.icon) errors.push(`${id} icon empty`)
    if (!spec.desc || spec.desc.length > 60) errors.push(`${id} desc empty or too long`)
    if (!spec.recommendedSourceHint || spec.recommendedSourceHint.length > 40) {
      errors.push(`${id} recommendedSourceHint empty or too long`)
    }
    if (!Array.isArray(spec.recommendedArtifactKinds)) {
      errors.push(`${id} recommendedArtifactKinds not array`)
    } else {
      for (const k of spec.recommendedArtifactKinds) {
        if (!isArtifactKind(k)) errors.push(`${id} invalid artifact kind: ${k}`)
      }
    }
    if (!Array.isArray(spec.starterQuestions) || spec.starterQuestions.length < 1) {
      errors.push(`${id} starterQuestions must have ≥ 1 entry`)
    } else {
      for (const q of spec.starterQuestions) {
        if (q.length > 50) errors.push(`${id} starterQuestion too long: "${q}"`)
      }
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

// ── N-007: DB layer ──────────────────────────────────────────────────────────
// notebook_template 表见 services/pgDb.ts runPgMigrations() 与 migrations/002-...
//
// 设计要点：
//   - 模板内容真源在 DB；NOTEBOOK_TEMPLATES 常量退化为 seed 数据 + system 类型 narrowing
//   - getTemplateByKey 应用与 loadTemplatesFromDb 相同的可见性规则（per-row）
//   - seedSystemTemplatesIfMissing 在启动时调，幂等（按 template_key 比对增量插入）
//
// 为啥 fail closed：DB 层抖动时不希望前端拿到任何「user 模板」，所以异常都会
// fall back 到只返回 system 模板（来自常量 NOTEBOOK_TEMPLATES）。这样保证 UI 起码
// 能创建 notebook，不至于完全瘫痪。

interface NotebookTemplateRow {
  id: number
  template_key: string
  source: NotebookTemplateSource
  owner_user_id: number | null
  label: string
  icon: string
  description: string
  recommended_source_hint: string
  recommended_artifact_kinds: unknown
  starter_questions: unknown
}

function rowToSpec(r: NotebookTemplateRow): NotebookTemplateSpec {
  const rawKinds = Array.isArray(r.recommended_artifact_kinds)
    ? r.recommended_artifact_kinds : []
  const kinds = rawKinds.filter((k): k is ArtifactKind =>
    typeof k === 'string' && isArtifactKind(k))
  const rawQuestions = Array.isArray(r.starter_questions) ? r.starter_questions : []
  const questions = rawQuestions.filter((q): q is string => typeof q === 'string')
  return {
    id: r.template_key,
    source: r.source,
    label: r.label,
    icon: r.icon,
    desc: r.description,
    recommendedSourceHint: r.recommended_source_hint,
    recommendedArtifactKinds: kinds,
    starterQuestions: questions,
  }
}

/** 系统模板的 fallback：DB 不可用时退回常量列表 */
function systemFallback(): NotebookTemplateSpec[] {
  return ALL_NOTEBOOK_TEMPLATE_IDS.map((id) => NOTEBOOK_TEMPLATES[id])
}

/**
 * 读当前用户可见的模板列表。
 * 可见性：
 *   - source = 'system' / 'community'：所有用户可见
 *   - source = 'user'：仅 owner_user_id == userId 可见
 *   - isAdmin：可见全部
 *
 * 排序：created_at DESC, id DESC。
 *
 * DB 失败 → 退回 systemFallback()（fail closed）。
 */
export async function loadTemplatesFromDb(opts: {
  userId: number
  isAdmin?: boolean
}): Promise<NotebookTemplateSpec[]> {
  const pool = getPgPool()
  try {
    if (opts.isAdmin) {
      const { rows } = await pool.query<NotebookTemplateRow>(
        `SELECT id, template_key, source, owner_user_id, label, icon, description,
                recommended_source_hint, recommended_artifact_kinds, starter_questions
         FROM notebook_template
         ORDER BY created_at DESC, id DESC`,
      )
      return rows.map(rowToSpec)
    }
    const { rows } = await pool.query<NotebookTemplateRow>(
      `SELECT id, template_key, source, owner_user_id, label, icon, description,
              recommended_source_hint, recommended_artifact_kinds, starter_questions
       FROM notebook_template
       WHERE source IN ('system', 'community')
          OR (source = 'user' AND owner_user_id = $1)
       ORDER BY created_at DESC, id DESC`,
      [opts.userId],
    )
    return rows.map(rowToSpec)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notebookTemplates] loadTemplatesFromDb failed; fallback to system constants:', err)
    return systemFallback()
  }
}

/**
 * 按 template_key 查单个模板，应用与 loadTemplatesFromDb 相同的可见性规则。
 * 不存在 / 不可见 → null。
 *
 * DB 失败 → 退回常量；常量没有 → null。
 */
export async function getTemplateByKey(opts: {
  key: string
  userId: number
  isAdmin?: boolean
}): Promise<NotebookTemplateSpec | null> {
  if (typeof opts.key !== 'string' || opts.key.length === 0) return null
  const pool = getPgPool()
  try {
    const { rows } = await pool.query<NotebookTemplateRow>(
      `SELECT id, template_key, source, owner_user_id, label, icon, description,
              recommended_source_hint, recommended_artifact_kinds, starter_questions
       FROM notebook_template
       WHERE template_key = $1
       LIMIT 1`,
      [opts.key],
    )
    if (rows.length === 0) return null
    const row = rows[0]
    if (opts.isAdmin) return rowToSpec(row)
    if (row.source === 'system' || row.source === 'community') return rowToSpec(row)
    if (row.source === 'user' && row.owner_user_id === opts.userId) return rowToSpec(row)
    return null
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notebookTemplates] getTemplateByKey failed; fallback to constants:', err)
    if (isNotebookTemplateId(opts.key)) {
      return NOTEBOOK_TEMPLATES[opts.key]
    }
    return null
  }
}

/**
 * Startup hook：扫描 DB 中已有的 source='system' 模板 key，对比 NOTEBOOK_TEMPLATES
 * 常量，把缺的写入 DB。幂等（重复调只插入缺的）。
 *
 * 老数据兼容：DB 里已有的同 key 模板**不会**被覆盖更新——升级模板内容请走单独 SQL
 * 或按需在 commit message 里加额外 UPDATE。这里追求最小副作用。
 */
export async function seedSystemTemplatesIfMissing(): Promise<{ seeded: number }> {
  const pool = getPgPool()
  let seeded = 0
  try {
    const { rows } = await pool.query<{ template_key: string }>(
      `SELECT template_key FROM notebook_template WHERE source = 'system'`,
    )
    const existing = new Set(rows.map((r) => r.template_key))
    for (const id of ALL_NOTEBOOK_TEMPLATE_IDS) {
      if (existing.has(id)) continue
      const spec = NOTEBOOK_TEMPLATES[id]
      await pool.query(
        `INSERT INTO notebook_template
         (template_key, source, owner_user_id, label, icon, description,
          recommended_source_hint, recommended_artifact_kinds, starter_questions)
         VALUES ($1, 'system', NULL, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
         ON CONFLICT (template_key) DO NOTHING`,
        [
          spec.id,
          spec.label,
          spec.icon,
          spec.desc,
          spec.recommendedSourceHint,
          JSON.stringify(spec.recommendedArtifactKinds),
          JSON.stringify(spec.starterQuestions),
        ],
      )
      seeded++
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notebookTemplates] seedSystemTemplatesIfMissing failed (skipped):', err)
  }
  return { seeded }
}

// ── N-008: 用户自定义模板 CRUD ────────────────────────────────────────────────

/**
 * env 守卫：USER_TEMPLATES_ENABLED，默认 true。识别 false / 0 / off / no 关闭。
 * 关闭时所有 4 个 API 返 404；前端入口隐藏（API meta 端点暴露此 flag）。
 */
export function isUserTemplatesEnabled(): boolean {
  const v = (process.env.USER_TEMPLATES_ENABLED ?? '').toLowerCase().trim()
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false
  return true
}

export interface CreateUserTemplateInput {
  label: string
  icon: string
  description: string
  recommendedSourceHint: string
  recommendedArtifactKinds: ArtifactKind[]
  starterQuestions: string[]
}

export type ValidateUserTemplateResult =
  | { ok: true; data: CreateUserTemplateInput }
  | { ok: false; errors: Record<string, string> }

/**
 * 校验用户自定义模板 input。
 *
 * 字段约束（与 design.md / spec 同步）：
 *   - label                     1..10 chars
 *   - icon                      1..2 chars (单 emoji；不严格校验 grapheme 因 emoji
 *                                   多字节，仅控制 length 上限)
 *   - description               1..60 chars
 *   - recommendedSourceHint     1..40 chars
 *   - recommendedArtifactKinds  0..3, 每个 ∈ ARTIFACT_REGISTRY
 *   - starterQuestions          1..3, 每条 1..50 chars
 *
 * @param partial 是否允许部分缺省（PATCH 用），默认 false（POST 用，全字段必填）
 */
export function validateUserTemplateInput(
  input: unknown,
  partial = false,
): ValidateUserTemplateResult {
  const errors: Record<string, string> = {}
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: { _: 'body must be object' } }
  }
  const o = input as Record<string, unknown>

  // forbid 改 source / template_key / owner_user_id（PATCH 时 input 可能含这些字段）
  for (const k of ['source', 'template_key', 'owner_user_id', 'id'] as const) {
    if (k in o) errors[k] = `字段 ${k} 不允许由用户设置/修改`
  }

  function checkStr(field: keyof CreateUserTemplateInput, min: number, max: number) {
    const v = o[field]
    if (v === undefined) {
      if (!partial) errors[field] = `${field} 必填`
      return undefined
    }
    if (typeof v !== 'string') {
      errors[field] = `${field} 必须是 string`
      return undefined
    }
    const t = v.trim()
    if (t.length < min) errors[field] = `${field} 至少 ${min} 字`
    else if (t.length > max) errors[field] = `${field} 最多 ${max} 字`
    return t
  }

  const label = checkStr('label', 1, 10)
  const icon = checkStr('icon', 1, 2)
  const description = checkStr('description', 1, 60)
  const recommendedSourceHint = checkStr('recommendedSourceHint', 1, 40)

  let recommendedArtifactKinds: ArtifactKind[] | undefined
  if (o.recommendedArtifactKinds === undefined) {
    if (!partial) errors.recommendedArtifactKinds = 'recommendedArtifactKinds 必填（可空数组）'
  } else if (!Array.isArray(o.recommendedArtifactKinds)) {
    errors.recommendedArtifactKinds = 'recommendedArtifactKinds 必须是数组'
  } else if (o.recommendedArtifactKinds.length > 3) {
    errors.recommendedArtifactKinds = 'recommendedArtifactKinds 最多 3 个'
  } else {
    const bad: string[] = []
    const cleaned: ArtifactKind[] = []
    for (const k of o.recommendedArtifactKinds) {
      if (typeof k !== 'string' || !isArtifactKind(k)) {
        bad.push(typeof k === 'string' ? k : '<non-string>')
      } else {
        cleaned.push(k)
      }
    }
    if (bad.length > 0) {
      errors.recommendedArtifactKinds = `不识别的 artifact kind: ${bad.join(', ')}`
    } else {
      recommendedArtifactKinds = cleaned
    }
  }

  let starterQuestions: string[] | undefined
  if (o.starterQuestions === undefined) {
    if (!partial) errors.starterQuestions = 'starterQuestions 必填（1-3 条）'
  } else if (!Array.isArray(o.starterQuestions)) {
    errors.starterQuestions = 'starterQuestions 必须是数组'
  } else if (o.starterQuestions.length < 1 || o.starterQuestions.length > 3) {
    errors.starterQuestions = 'starterQuestions 必须 1-3 条'
  } else {
    const cleaned: string[] = []
    let bad = false
    for (const q of o.starterQuestions) {
      if (typeof q !== 'string') { bad = true; break }
      const t = q.trim()
      if (t.length < 1 || t.length > 50) { bad = true; break }
      cleaned.push(t)
    }
    if (bad) {
      errors.starterQuestions = '每条 starterQuestion 必须 1-50 字 string'
    } else {
      starterQuestions = cleaned
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  // 构造干净 data（缺失字段在 partial 模式下不出现）
  const data: Partial<CreateUserTemplateInput> = {}
  if (label !== undefined) data.label = label
  if (icon !== undefined) data.icon = icon
  if (description !== undefined) data.description = description
  if (recommendedSourceHint !== undefined) data.recommendedSourceHint = recommendedSourceHint
  if (recommendedArtifactKinds !== undefined) data.recommendedArtifactKinds = recommendedArtifactKinds
  if (starterQuestions !== undefined) data.starterQuestions = starterQuestions

  return { ok: true, data: data as CreateUserTemplateInput }
}

/** 生成用户模板 key：`user_<userId>_<8 hex>`，碰撞概率 1/2^32 */
function generateUserTemplateKey(userId: number): string {
  const suffix = randomBytes(4).toString('hex')   // 8 hex chars
  return `user_${userId}_${suffix}`
}

/**
 * 用户创建自己的模板。
 *
 * - 调用方需先 validate → ok
 * - INSERT source='user', owner_user_id=userId
 * - DB 返完整行 → 返 NotebookTemplateSpec
 *
 * unique 冲突（极小概率 nanoid 撞）→ 重试 1 次
 */
export async function createUserTemplate(
  userId: number,
  input: CreateUserTemplateInput,
): Promise<NotebookTemplateSpec> {
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error('createUserTemplate: invalid userId')
  }
  const pool = getPgPool()

  for (let attempt = 0; attempt < 2; attempt++) {
    const key = generateUserTemplateKey(userId)
    try {
      const { rows } = await pool.query<NotebookTemplateRow>(
        `INSERT INTO notebook_template
           (template_key, source, owner_user_id, label, icon, description,
            recommended_source_hint, recommended_artifact_kinds, starter_questions)
         VALUES ($1, 'user', $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
         RETURNING id, template_key, source, owner_user_id, label, icon, description,
                   recommended_source_hint, recommended_artifact_kinds, starter_questions`,
        [
          key, userId,
          input.label, input.icon, input.description,
          input.recommendedSourceHint,
          JSON.stringify(input.recommendedArtifactKinds),
          JSON.stringify(input.starterQuestions),
        ],
      )
      return rowToSpec(rows[0])
    } catch (err) {
      // 23505 = PG unique violation；唯一冲突时重试
      const code = (err as { code?: string })?.code
      if (code === '23505' && attempt === 0) {
        // eslint-disable-next-line no-console
        console.warn('[notebookTemplates] template_key collision, retry')
        continue
      }
      throw err
    }
  }
  // 两次都撞了 — 不可能（4 字节随机 = 1/2^32 概率），但抛
  throw new Error('createUserTemplate: failed after 2 retries')
}

/**
 * 编辑用户自定义模板。
 *
 * - lookup → 不存在 / null
 * - 不允许改 source ≠ 'user'：抛 ForbiddenError
 * - owner ≠ userId 且 ¬isAdmin：抛 ForbiddenError
 * - 仅 patch 提供的字段；updated_at = NOW()
 */
export async function updateUserTemplate(opts: {
  key: string
  userId: number
  isAdmin: boolean
  patch: Partial<CreateUserTemplateInput>
}): Promise<{ ok: true; spec: NotebookTemplateSpec }
         | { ok: false; reason: 'not_found' | 'forbidden' | 'system_or_community_immutable' }> {
  if (typeof opts.key !== 'string' || opts.key.length === 0) {
    return { ok: false, reason: 'not_found' }
  }
  const pool = getPgPool()
  const { rows: existing } = await pool.query<NotebookTemplateRow>(
    `SELECT id, template_key, source, owner_user_id, label, icon, description,
            recommended_source_hint, recommended_artifact_kinds, starter_questions
     FROM notebook_template WHERE template_key = $1 LIMIT 1`,
    [opts.key],
  )
  if (existing.length === 0) return { ok: false, reason: 'not_found' }
  const row = existing[0]

  // 不许改 system / community 模板（即便 admin 想改也不行：避免误改 seed）
  if (row.source !== 'user') {
    return { ok: false, reason: 'system_or_community_immutable' }
  }
  // 普通用户只能改自己的
  if (!opts.isAdmin && row.owner_user_id !== opts.userId) {
    return { ok: false, reason: 'forbidden' }
  }

  const sets: string[] = []
  const params: unknown[] = []
  function bind(col: string, val: unknown) {
    params.push(val)
    sets.push(`${col} = $${params.length}`)
  }
  if (opts.patch.label !== undefined) bind('label', opts.patch.label)
  if (opts.patch.icon !== undefined) bind('icon', opts.patch.icon)
  if (opts.patch.description !== undefined) bind('description', opts.patch.description)
  if (opts.patch.recommendedSourceHint !== undefined) {
    bind('recommended_source_hint', opts.patch.recommendedSourceHint)
  }
  if (opts.patch.recommendedArtifactKinds !== undefined) {
    params.push(JSON.stringify(opts.patch.recommendedArtifactKinds))
    sets.push(`recommended_artifact_kinds = $${params.length}::jsonb`)
  }
  if (opts.patch.starterQuestions !== undefined) {
    params.push(JSON.stringify(opts.patch.starterQuestions))
    sets.push(`starter_questions = $${params.length}::jsonb`)
  }
  if (sets.length === 0) {
    // 啥都没 patch：直接返当前 spec（friendlier than 400）
    return { ok: true, spec: rowToSpec(row) }
  }
  sets.push('updated_at = NOW()')
  params.push(opts.key)

  const { rows } = await pool.query<NotebookTemplateRow>(
    `UPDATE notebook_template SET ${sets.join(', ')}
     WHERE template_key = $${params.length}
     RETURNING id, template_key, source, owner_user_id, label, icon, description,
               recommended_source_hint, recommended_artifact_kinds, starter_questions`,
    params,
  )
  if (rows.length === 0) return { ok: false, reason: 'not_found' }
  return { ok: true, spec: rowToSpec(rows[0]) }
}

/**
 * 删除用户自定义模板。
 *
 * - 不存在 → { deleted: false, reason: 'not_found' }
 * - source != 'user' → { deleted: false, reason: 'system_or_community_immutable' }
 * - 非 owner 且 非 admin → { deleted: false, reason: 'forbidden' }
 * - DELETE → { deleted: true }
 *
 * 注意：notebook.template_id 不级联清空（dangling reference 由前端 graceful 渲染）
 */
export async function deleteUserTemplate(opts: {
  key: string
  userId: number
  isAdmin: boolean
}): Promise<{ deleted: true } | { deleted: false; reason: 'not_found' | 'forbidden' | 'system_or_community_immutable' }> {
  if (typeof opts.key !== 'string' || opts.key.length === 0) {
    return { deleted: false, reason: 'not_found' }
  }
  const pool = getPgPool()
  const { rows } = await pool.query<{ source: NotebookTemplateSource; owner_user_id: number | null }>(
    `SELECT source, owner_user_id FROM notebook_template
     WHERE template_key = $1 LIMIT 1`,
    [opts.key],
  )
  if (rows.length === 0) return { deleted: false, reason: 'not_found' }
  const row = rows[0]
  if (row.source !== 'user') {
    return { deleted: false, reason: 'system_or_community_immutable' }
  }
  if (!opts.isAdmin && row.owner_user_id !== opts.userId) {
    return { deleted: false, reason: 'forbidden' }
  }
  await pool.query(
    `DELETE FROM notebook_template WHERE template_key = $1`,
    [opts.key],
  )
  return { deleted: true }
}
