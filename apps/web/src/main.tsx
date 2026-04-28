// ⚠️ 必须第一行：在任何其它模块 import axios 之前挂好 interceptors + patch axios.create
import './api/client'

// crypto.randomUUID polyfill —— 现代浏览器只在 secure context（HTTPS / localhost）
// 暴露 crypto.randomUUID；HTTP + 私有 IP（如 http://192.168.3.21:15173 内网部署）
// 会触发 "crypto.randomUUID is not a function"。补一个 RFC4122 v4 等价实现。
// 安全等级：Math.random 不是 crypto-secure，但用作 UUID（消息 id / session id 等
// 非安全敏感场景）足够。安全敏感用途仍应走真 crypto.subtle。
if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID !== 'function') {
  // @ts-expect-error  polyfill insecure-context fallback
  globalThis.crypto.randomUUID = function randomUUIDPolyfill(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    }) as ReturnType<typeof globalThis.crypto.randomUUID>
  }
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>
)
