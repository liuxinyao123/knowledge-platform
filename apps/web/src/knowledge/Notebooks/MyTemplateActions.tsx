/**
 * MyTemplateActions —— 用户自定义模板的 hover 操作（编辑 / 删除）
 *
 * 仅在 NotebookSelector 渲染 source='user' 模板时显示。
 * 鼠标 hover 整个 TemplateOption 时浮现两个圆形小按钮。
 */
import { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { type NotebookTemplateSpec } from '@/api/notebooks'

interface Props {
  template: NotebookTemplateSpec
  visible: boolean   // 父组件 hover state 控制
  onEdit: (t: NotebookTemplateSpec) => void
  onDelete: (t: NotebookTemplateSpec) => void
}

export default function MyTemplateActions({ template, visible, onEdit, onDelete }: Props) {
  const { t } = useTranslation('notebook')
  return (
    <div style={{
      ...container,
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? 'auto' : 'none',
    }}>
      <button
        type="button"
        title={t('myTemplateActions.edit')}
        aria-label={t('myTemplateActions.edit')}
        onClick={(e) => { e.stopPropagation(); onEdit(template) }}
        style={iconBtn}
      >✎</button>
      <button
        type="button"
        title={t('myTemplateActions.delete')}
        aria-label={t('myTemplateActions.delete')}
        onClick={(e) => {
          e.stopPropagation()
          if (!confirm(t('myTemplateActions.deleteConfirm', { label: template.label }))) {
            return
          }
          onDelete(template)
        }}
        style={{ ...iconBtn, color: '#dc2626' }}
      >×</button>
    </div>
  )
}

const container: CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 4,
  display: 'flex',
  gap: 4,
  transition: 'opacity 120ms',
}

const iconBtn: CSSProperties = {
  width: 22,
  height: 22,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: '#fff',
  color: 'var(--muted)',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  padding: 0,
}
