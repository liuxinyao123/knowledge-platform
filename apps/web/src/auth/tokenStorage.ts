/**
 * tokenStorage —— localStorage 封装
 * 风险：XSS 可盗；生产上如需提升安全，切 httpOnly cookie 仅改此文件 + 后端 Set-Cookie
 */
const KEY = 'dsclaw.auth.token'

export const tokenStorage = {
  get(): string | null {
    try { return localStorage.getItem(KEY) } catch { return null }
  },
  set(token: string): void {
    try { localStorage.setItem(KEY, token) } catch { /* 静音 */ }
  },
  clear(): void {
    try { localStorage.removeItem(KEY) } catch { /* 静音 */ }
  },
}
