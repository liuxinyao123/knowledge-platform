/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import type { ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/** dev 与 preview 共用：否则 `vite preview` 下 /api/* 会落到静态资源返回 404 */
const apiProxy: Record<string, ProxyOptions> = {
  '/api/bookstack': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/qa': {
    target: 'http://localhost:3001',
    changeOrigin: true,
    // SSE: disable proxy timeouts so the long-lived stream is not cut off
    timeout: 0,
    proxyTimeout: 0,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('Connection', 'keep-alive')
      })
      proxy.on('proxyRes', (proxyRes) => {
        proxyRes.socket?.setNoDelay(true)
      })
    },
  },
  '/api/governance': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/sync': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/ingest': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/asset-directory': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/knowledge': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/agent': {
    target: 'http://localhost:3001',
    changeOrigin: true,
    // SSE 长连接：同 /api/qa
    timeout: 0,
    proxyTimeout: 0,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('Connection', 'keep-alive')
      })
    },
  },
  '/api/acl': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/auth': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/mcp': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/graph': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/eval': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/iam': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/file-sources': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/api/notebooks': {
    target: 'http://localhost:3001',
    changeOrigin: true,
    // notebook chat 走 SSE：同 /api/qa
    timeout: 0,
    proxyTimeout: 0,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('Connection', 'keep-alive')
      })
      proxy.on('proxyRes', (proxyRes) => {
        proxyRes.socket?.setNoDelay(true)
      })
    },
  },
  // space-permissions (ADR 2026-04-23-26)
  '/api/spaces': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  // knowledge-graph (ADR 2026-04-23-27)
  '/api/kg': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  // ontology OAG (ADR 2026-04-24-33)
  '/api/ontology': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  // action framework (ADR 2026-04-24-35 / ADR-38 UI 接通)
  '/api/actions': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    // 同时监听 IPv4，避免仅 ::1 时 http://127.0.0.1:5173 无法打开
    host: true,
    proxy: { ...apiProxy },
  },
  preview: {
    proxy: { ...apiProxy },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
