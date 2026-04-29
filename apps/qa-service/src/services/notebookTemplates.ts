/**
 * services/notebookTemplates.ts —— Notebook 模板系统（N-006）
 *
 * 6 个内置模板（研究综述 / 会议准备 / 竞品分析 / 学习辅助 / 项目复盘 / 翻译解释），
 * 每个模板承载：场景说明 + 推荐 sources 类型 + 推荐 artifact 套件（复用 N-002
 * ARTIFACT_REGISTRY）+ 推荐起手提问。
 *
 * 设计原则（详见 openspec/changes/notebook-templates/design.md）：
 *   - 模板 = 配置（不是自动化）：用户保留控制权，模板只是 UI 引导
 *   - 模板内容存代码注册表，DB 只存 template_id；模板升级老 notebook 看到新版
 *   - 提示卡可 dismiss（前端 localStorage 记忆）
 *
 * N-008 候选：未来扩为允许用户提交自定义模板时，复用 NotebookTemplateSpec schema。
 */
import type { ArtifactKind } from './artifactGenerator.ts'
import { isArtifactKind } from './artifactGenerator.ts'

// ── 类型 ─────────────────────────────────────────────────────────────────────

export type NotebookTemplateId =
  | 'research_review'
  | 'meeting_prep'
  | 'competitive_analysis'
  | 'learning_aid'
  | 'project_retrospective'
  | 'translation_explain'

export interface NotebookTemplateSpec {
  id: NotebookTemplateId
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
