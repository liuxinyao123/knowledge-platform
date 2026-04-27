import axios from 'axios'
import type {
  BSShelf,
  BSBook,
  BSChapter,
  BSPage,
  BSPageDetail,
  BSSearchResult,
  BSListResponse,
  BSImport,
} from '@/types/bookstack'

const client = axios.create({
  baseURL: '/api/bookstack',
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.response.use(
  (res) => res,
  (err) => {
    const st = err.response?.status
    if (st === 401 || st === 503) {
      // eslint-disable-next-line no-console
      console.error(
        'BookStack 经 qa-service 代理访问失败：请确认 qa-service 已启动且已配置 BOOKSTACK_TOKEN_ID/BOOKSTACK_TOKEN_SECRET',
      )
    }
    return Promise.reject(err)
  }
)

export const bsApi = {
  getShelves: (params?: { count?: number }) =>
    client.get<BSListResponse<BSShelf>>('/shelves', { params }).then((r) => r.data),

  getBooks: (params?: { count?: number }) =>
    client.get<BSListResponse<BSBook>>('/books', { params }).then((r) => r.data),

  getPages: (params?: { count?: number; sort?: string }) =>
    client.get<BSListResponse<BSPage>>('/pages', { params }).then((r) => r.data),

  getShelf: (id: number) =>
    client.get<BSShelf & { books: BSBook[] }>(`/shelves/${id}`).then((r) => r.data),

  getBook: (id: number) =>
    client
      .get<BSBook & { contents: (BSChapter | BSPage)[] }>(`/books/${id}`)
      .then((r) => r.data),

  getChapter: (id: number) =>
    client.get<BSChapter & { pages: BSPage[] }>(`/chapters/${id}`).then((r) => r.data),

  search: (query: string, count = 20) =>
    client
      .get<BSListResponse<BSSearchResult>>('/search', { params: { query, count } })
      .then((r) => r.data),

  getPage: (id: number) => client.get<BSPageDetail>(`/pages/${id}`).then((r) => r.data),

  createPage: (data: { book_id: number; name: string; html?: string; markdown?: string }) =>
    client.post<BSPage>('/pages', data).then((r) => r.data),

  uploadAttachment: (formData: FormData) =>
    client
      .post('/attachments', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data),

  createImport: (formData: FormData) =>
    client
      .post<BSImport>('/imports', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data),

  pollImport: (id: number) => client.get<BSImport>(`/imports/${id}`).then((r) => r.data),

  getUsers: () => client.get('/users').then((r) => r.data),

  updateUserRoles: (userId: number, roleIds: number[]) =>
    client.put(`/users/${userId}`, { roles: roleIds }).then((r) => r.data),

  getRoles: () => client.get('/roles').then((r) => r.data),

  createRole: (data: { display_name: string; description?: string; permissions?: string[] }) =>
    client.post('/roles', data).then((r) => r.data),

  createShelf: (data: { name: string; description?: string }) =>
    client.post<BSShelf>('/shelves', data).then((r) => r.data),

  createBook: (data: { name: string; shelf_id?: number }) =>
    client.post<BSBook>('/books', data).then((r) => r.data),

  getAuditLog: (params?: { count?: number }) =>
    client
      .get<BSListResponse<{
        id: number; type: string; detail: string
        user_id: number; loggable_id: number | null; loggable_type: string | null
        ip: string; created_at: string
        user: { id: number; name: string; slug: string }
      }>>('/audit-log', { params })
      .then((r) => r.data),
}

