/**
 * src/test/setup.ts —— vitest global setup
 *
 * 1. @testing-library/jest-dom 扩展 expect()
 * 2. （2026-04-25 OQ-WEB-TEST-DEBT 修复路径 4）全局 axios 拦截：
 *    所有 axios.create({baseURL:'/api/*'}) 实例的 get/post/put/patch/delete 默认 resolve 为
 *    `{data:{}, status:200, ...}`，避免组件测试 mount 时打真实 HTTP 导致 ERR_NETWORK。
 *
 *    个别测试需要特定响应时，按既有模式 `vi.mock('@/api/foo', ...)` 在 file 顶部覆盖
 *    api 包装层即可（高于此处的 axios 层 mock 优先级）。
 */
import '@testing-library/jest-dom'
import { vi } from 'vitest'

vi.mock('axios', () => {
  // 默认返 shape 友好型空响应，覆盖常见列表 / 计数 / 详情结构。
  // 避免组件里 `data.items.map(...)` / `data.rows.length` / `data.total` 触发
  // "undefined.map" / "undefined.length" 之类下游报错，把"测试缺 mock"的失败收敛成
  // "渲染空态"路径，让大部分测试至少跑完渲染。
  const DEFAULT_BODY = {
    items: [],
    data: [],
    rows: [],
    list: [],
    results: [],
    chunks: [],
    nodes: [],
    edges: [],
    total: 0,
    count: 0,
    ok: true,
  }

  const fakeResponse = (data: unknown = DEFAULT_BODY) => ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as Record<string, unknown>,
  })

  const okPromise = (data: unknown = DEFAULT_BODY) => Promise.resolve(fakeResponse(data))

  /** 创建一个最小满足 AxiosInstance 调用面的 stub */
  const makeInstance = () => ({
    get:     vi.fn(() => okPromise()),
    post:    vi.fn(() => okPromise()),
    put:     vi.fn(() => okPromise()),
    patch:   vi.fn(() => okPromise()),
    delete:  vi.fn(() => okPromise()),
    head:    vi.fn(() => okPromise()),
    options: vi.fn(() => okPromise()),
    request: vi.fn(() => okPromise()),
    defaults: { headers: {} },
    interceptors: {
      request:  { use: vi.fn(), eject: vi.fn(), clear: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn(), clear: vi.fn() },
    },
  })

  // 顶层 axios 也 stub（极少数代码直接 `axios.get(...)` 而非 create 实例）
  const topLevel: Record<string, unknown> = {
    create: vi.fn(makeInstance),
    get:     vi.fn(() => okPromise()),
    post:    vi.fn(() => okPromise()),
    put:     vi.fn(() => okPromise()),
    patch:   vi.fn(() => okPromise()),
    delete:  vi.fn(() => okPromise()),
    head:    vi.fn(() => okPromise()),
    options: vi.fn(() => okPromise()),
    request: vi.fn(() => okPromise()),
    isAxiosError: vi.fn(() => false),
    isCancel: vi.fn(() => false),
    Cancel: class {},
    CancelToken: { source: () => ({ token: {}, cancel: vi.fn() }) },
    defaults: { headers: {} },
    interceptors: {
      request:  { use: vi.fn(), eject: vi.fn(), clear: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn(), clear: vi.fn() },
    },
  }

  return {
    default: topLevel,
    ...topLevel,
  }
})
