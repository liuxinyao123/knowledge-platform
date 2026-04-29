/**
 * TemplateHintCard —— Notebook Detail 顶部的模板推荐提示卡（N-006）
 *
 * 当 notebook.template_id 存在 + localStorage 没 dismiss 标记时显示。
 * 内容：模板 label / icon / desc / recommendedSourceHint /
 *      推荐 artifact 按钮（点击触发 generateArtifact）/
 *      starter questions 芯片（点击预填到 ChatPanel input）/
 *      关闭按钮（dismiss → localStorage 记忆，永久不再显示）
 */
import { useEffect, useState } from 'react'
import {
  listTemplates, type NotebookTemplateId, type NotebookTemplateSpec,
  type ArtifactKind,
} from '@/api/notebooks'

interface Props {
  notebookId: number
  templateId: NotebookTemplateId
  onTriggerArtifact: (kind: ArtifactKind) => void
  onPickStarter: (question: string) => void
}

function dismissKey(notebookId: number) {
  return `notebook_${notebookId}_template_hint_dismissed`
}

export default function TemplateHintCard({
  notebookId, templateId, onTriggerArtifact, onPickStarter,
}: Props) {
  const [spec, setSpec] = useState<NotebookTemplateSpec | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(localStorage.getItem(dismissKey(notebookId)) === '1')
  }, [notebookId])

  useEffect(() => {
    let cancel = false
    listTemplates()
      .then((all) => { if (!cancel) setSpec(all.find((t) => t.id === templateId) ?? null) })
      .catch(() => { if (!cancel) setSpec(null) })
    return () => { cancel = true }
  }, [templateId])

  if (dismissed || !spec) return null

  return (
    <div style={{
      background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10,
      padding: 12, marginBottom: 12, position: 'relative',
    }}>
      {/* 关闭按钮 */}
      <button
        type="button"
        title="不再显示这条提示（per-notebook 记忆）"
        onClick={() => {
          localStorage.setItem(dismissKey(notebookId), '1')
          setDismissed(true)
        }}
        style={{
          position: 'absolute', top: 6, right: 8,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#475569', fontSize: 16, lineHeight: 1, padding: 4,
        }}
      >×</button>

      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e3a8a', marginBottom: 4 }}>
        {spec.icon} {spec.label} 模板
      </div>
      <div style={{ fontSize: 12, color: '#475569', marginBottom: 6 }}>
        {spec.desc}
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
        💡 {spec.recommendedSourceHint}
      </div>

      {/* 推荐 artifact 按钮 */}
      {spec.recommendedArtifactKinds.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: '#475569', marginBottom: 4 }}>推荐生成：</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {spec.recommendedArtifactKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => onTriggerArtifact(kind)}
                title={`触发生成 ${kind}（去 Studio 面板看进度）`}
                style={{
                  fontSize: 11, padding: '3px 10px',
                  background: '#fff', border: '1px solid #bfdbfe',
                  borderRadius: 999, color: '#1e40af', cursor: 'pointer',
                }}
              >{kind}</button>
            ))}
          </div>
        </div>
      )}

      {/* 起手问题芯片 */}
      <div>
        <div style={{ fontSize: 11, color: '#475569', marginBottom: 4 }}>推荐起手提问：</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {spec.starterQuestions.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPickStarter(q)}
              title="点击预填到下方输入框"
              style={{
                textAlign: 'left', fontSize: 12, padding: '5px 10px',
                background: '#fff', border: '1px solid #bfdbfe',
                borderRadius: 6, color: '#1e40af', cursor: 'pointer',
              }}
            >• {q}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
