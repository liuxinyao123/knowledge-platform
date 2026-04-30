/**
 * /login —— 登录页
 * 独立路由（不进 RequireAuth + Layout 外壳）
 */
import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth/AuthContext'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, user } = useAuth()
  const { t } = useTranslation('auth')

  const fromParam = new URLSearchParams(location.search).get('from')
  const redirectTo = fromParam ? decodeURIComponent(fromParam) : '/overview'

  const [email, setEmail] = useState('admin@dsclaw.local')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 如已登录，直接跳回
  useEffect(() => {
    if (user) navigate(redirectTo, { replace: true })
  }, [user, redirectTo, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await login(email.trim(), password)
      navigate(redirectTo, { replace: true })
    } catch (e) {
      const err = e as {
        response?: { status?: number; data?: { error?: string } }
        message?: string
      }
      const status = err?.response?.status
      if (status === 500) {
        setErr(t('login.errorNoSecret'))
      } else if (status === 401) {
        setErr(t('login.errorInvalid'))
      } else {
        setErr(err?.response?.data?.error || err?.message || t('login.errorNetwork'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #f5f3ff 0%, #eef2ff 100%)',
      padding: 20,
    }}>
      <form
        onSubmit={(e) => void handleSubmit(e)}
        style={{
          width: '100%', maxWidth: 380,
          padding: 32,
          background: '#fff', borderRadius: 12,
          boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{
            width: 48, height: 48, margin: '0 auto 10px',
            borderRadius: 14,
            background: 'linear-gradient(135deg, #6C47FF 0%, #A78BFA 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24,
          }}>🧠</div>
          <h1 style={{ margin: 0, fontSize: 20, color: 'var(--text)' }}>{t('login.title')}</h1>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)' }}>{t('login.subtitle')}</div>
        </div>

        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{t('login.emailLabel')}</div>
          <input
            data-testid="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: '100%', padding: '9px 12px', fontSize: 14,
              border: '1px solid var(--border)', borderRadius: 8,
              boxSizing: 'border-box',
            }}
          />
        </label>

        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{t('login.passwordLabel')}</div>
          <input
            data-testid="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              width: '100%', padding: '9px 12px', fontSize: 14,
              border: '1px solid var(--border)', borderRadius: 8,
              boxSizing: 'border-box',
            }}
          />
        </label>

        {err && (
          <div style={{
            padding: '10px 12px', fontSize: 12,
            background: '#FEF2F2', color: '#B91C1C', borderRadius: 6,
          }}>
            {err}
          </div>
        )}

        <button
          data-testid="login-submit"
          type="submit"
          disabled={busy || !email || !password}
          className="btn primary"
          style={{ width: '100%', padding: '10px', fontSize: 14 }}
        >
          {busy ? t('login.submitting') : t('login.submit')}
        </button>

      </form>
    </div>
  )
}
