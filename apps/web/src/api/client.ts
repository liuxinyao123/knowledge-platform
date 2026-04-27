/**
 * api/client.ts —— 全局 axios 拦截器（模块副作用）
 *
 * ⚠️ 必须在任何 `axios.create(...)` 被调用之前加载。
 * 入口放在 main.tsx 最顶端 `import './api/client'`，保证先于 App 的任意子树 import。
 *
 * 做两件事：
 *   1. 给默认 axios 实例挂拦截器（兼容直接 `import axios from 'axios'` 的调用）
 *   2. Monkey-patch `axios.create`，使后续 create 出来的**所有**新实例自带同样的拦截器
 *      —— 因为各 api/*.ts 里都用 `axios.create({baseURL})`，它们产生的实例默认 **不** 继承全局拦截器
 *
 * 拦截器做：
 *   - 请求：如有 token 自动加 `Authorization: Bearer`
 *   - 响应：401 清 token 并跳 /login（保留原路径）
 */
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { tokenStorage } from '@/auth/tokenStorage'

function attach(inst: AxiosInstance): void {
  inst.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = tokenStorage.get()
    if (token) {
      config.headers = config.headers ?? {}
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })
  inst.interceptors.response.use(
    (r) => r,
    (err) => {
      const status = err?.response?.status
      if (status === 401) {
        tokenStorage.clear()
        const pathname = window.location.pathname
        if (pathname !== '/login') {
          const from = encodeURIComponent(pathname + window.location.search)
          window.location.href = `/login?from=${from}`
        }
      }
      return Promise.reject(err)
    },
  )
}

// (1) 挂默认实例
attach(axios)

// (2) Monkey-patch axios.create，新实例自动带拦截器
const originalCreate = axios.create.bind(axios)
axios.create = ((config?: Parameters<typeof axios.create>[0]) => {
  const inst = originalCreate(config)
  attach(inst)
  return inst
}) as typeof axios.create

// 保留 legacy export（main.tsx 里原本调用过）——改成 no-op，避免破坏已有 import
export function installAxiosInterceptors(): void {
  /* already installed at module load time */
}
