/**
 * AuthContext —— 前端全局 auth 状态
 * 在 main.tsx 用 <AuthProvider> 包裹整个 App
 * 任何组件用 useAuth() / usePermission() 查询当前用户身份
 *
 * 允许同文件导出 AuthProvider + useAuth + usePermission（context 的经典 pattern）。
 * 也允许 initial fetch 期的 setLoading(true) 在 effect 中级联（3 条 render 可接受）。
 */
/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { authApi, type MePayload } from '@/api/auth'
import { tokenStorage } from './tokenStorage'

interface AuthState {
  user: MePayload | null
  loading: boolean
  error: string | null
  hasPermission(name: string): boolean
  reload(): Promise<void>
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
}

const AuthCtx = createContext<AuthState>({
  user: null,
  loading: true,
  error: null,
  hasPermission: () => false,
  reload: async () => {},
  login: async () => {},
  logout: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setError(null)
    try {
      const me = await authApi.whoami()
      setUser(me)
    } catch (e) {
      // 未登录 / token 无效 / 后端没 DEV BYPASS
      // 401 会被全局拦截器处理跳 /login，这里只要把 user 置空
      const err = e as { response?: { status?: number; data?: { error?: string } }; message?: string }
      if (err?.response?.status === 401) {
        setUser(null)
      } else {
        setError(err?.response?.data?.error || err?.message || '加载身份失败')
        setUser(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: u } = await authApi.login(email, password)
    tokenStorage.set(token)
    // whoami 会把 dev_bypass 字段补全；登录成功直接当成最终状态写入也可以
    setUser({ ...u, dev_bypass: false })
    setError(null)
  }, [])

  const logout = useCallback(async () => {
    try { await authApi.logout() } catch { /* best effort */ }
    tokenStorage.clear()
    setUser(null)
  }, [])

  const hasPermission = useCallback(
    (name: string) => !!user && user.permissions.includes(name),
    [user],
  )

  return (
    <AuthCtx.Provider value={{ user, loading, error, hasPermission, reload, login, logout }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth(): AuthState {
  return useContext(AuthCtx)
}

/** 便利 hook：返 boolean */
export function usePermission(name: string): boolean {
  return useAuth().hasPermission(name)
}
