import axios from 'axios'

export interface MePayload {
  user_id: number
  email: string
  roles: string[]
  permissions: string[]
  dev_bypass: boolean
}

export interface LoginResponse {
  token: string
  user: {
    user_id: number
    email: string
    roles: string[]
    permissions: string[]
  }
}

const client = axios.create({ baseURL: '/api/auth' })

export const authApi = {
  whoami: (): Promise<MePayload> => client.get('/me').then((r) => r.data),

  login: (email: string, password: string): Promise<LoginResponse> =>
    client.post('/login', { email, password }).then((r) => r.data),

  logout: (): Promise<void> =>
    client.post('/logout').then(() => undefined),

  register: (email: string, password: string, roles: string[]): Promise<{ id: number }> =>
    client.post('/register', { email, password, roles }).then((r) => r.data),

  changePassword: (oldPassword: string, newPassword: string): Promise<void> =>
    client.post('/password', { oldPassword, newPassword }).then(() => undefined),
}
