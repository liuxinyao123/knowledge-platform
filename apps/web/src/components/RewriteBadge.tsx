/**
 * RewriteBadge —— condense 改写痕迹徽标（N-004）
 *
 * 后端 ragPipeline 在 retrieval 之前用 fast LLM 把短/指代型 follow-up
 * 改写成自洽问句，emit `rag_step` icon='🪄' label='指代改写：「X」→「Y」'。
 *
 * 本组件：
 * 1. 解析 ragSteps 中 🪄 项的 from/to
 * 2. 渲染轻量徽标，让用户知道"系统改写了你的问题用于检索"
 *
 * 共享给 Notebook ChatPanel + 全局 QA 两个场景。
 */

interface Step {
  icon: string
  label: string
}

/**
 * 从 ragSteps 数组里解析 condense 改写信息。
 * @returns null 表示没改写（要么 condense 没触发，要么 step 还没到）
 */
export function extractCondenseRewrite(steps: readonly Step[]): { from: string; to: string } | null {
  const rw = steps.find((s) => s.icon === '🪄')
  if (!rw) return null
  // label 形式："指代改写：「X」→「Y」"
  const m = rw.label.match(/「([^」]+)」\s*→\s*「([^」]+)」/)
  if (!m) return null
  return { from: m[1], to: m[2] }
}

interface Props {
  from: string
  to: string
}

export default function RewriteBadge({ from, to }: Props) {
  return (
    <div
      title="系统用 fast LLM 把你的问题改写成自洽问句以提高检索命中"
      style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
        padding: '6px 10px', background: '#eff6ff', border: '1px solid #bfdbfe',
        borderRadius: 8, fontSize: 11, color: '#1e40af',
        cursor: 'help', flexWrap: 'wrap',
      }}
    >
      <span aria-hidden>🪄</span>
      <span style={{ color: '#475569' }}>「{from}」</span>
      <span aria-hidden>→</span>
      <span style={{ fontWeight: 500 }}>「{to}」</span>
    </div>
  )
}
