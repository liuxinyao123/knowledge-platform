/**
 * LanguageSwitcher —— 顶部导航的语言下拉切换
 *
 * 行为：
 *   - 点击当前语言图标 / 文字展开下拉
 *   - 选中后 i18n.changeLanguage()，自动写 localStorage（detector 配置 caches: localStorage）
 *   - 当前语言用主紫色高亮
 *
 * 视觉跟其他 .tb-icon-btn 一致；展开层用 absolute 定位 + 简单卡片。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '@/i18n'

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // 点其它地方关闭
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const current = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.resolvedLanguage)
    ?? SUPPORTED_LANGUAGES[0]

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="tb-icon-btn"
        title={t('common.language.switchTitle')}
        aria-label={t('common.language.switchTitle')}
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 4, paddingInline: 8 }}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7.5" cy="7.5" r="5.5" />
          <path d="M2 7.5h11M7.5 2c2 2 2 9 0 11M7.5 2c-2 2-2 9 0 11" />
        </svg>
        <span style={{ fontSize: 11, fontWeight: 500 }}>{current.code.toUpperCase()}</span>
      </button>

      {open && (
        <div role="menu" style={dropdown}>
          {SUPPORTED_LANGUAGES.map((l) => {
            const active = l.code === i18n.resolvedLanguage
            return (
              <button
                key={l.code}
                type="button"
                role="menuitem"
                onClick={() => {
                  void i18n.changeLanguage(l.code)
                  setOpen(false)
                }}
                style={{
                  ...item,
                  color: active ? 'var(--p, #6C47FF)' : 'var(--text)',
                  fontWeight: active ? 600 : 400,
                  background: active ? 'rgba(108, 71, 255, 0.06)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent'
                }}
              >
                <span style={{ flex: 1 }}>{l.nativeLabel}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>
                  {l.code}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const dropdown: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  minWidth: 140,
  background: '#fff',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
  padding: 4,
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const item: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 10px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 12,
  textAlign: 'left',
  transition: 'background 100ms',
}
