/**
 * auth/signToken.ts —— HS256 JWT 签发
 *
 * 与 verifyToken.ts 对称：不引外部 JWT 库，直接用 Node crypto.createHmac。
 */
import { createHmac } from 'node:crypto'

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

export interface SignPayload {
  sub: number | string
  email?: string
  roles?: string[]
  permissions?: string[]
  [key: string]: unknown
}

/**
 * 签发 HS256 JWT。默认 TTL 24h。
 *
 * @param payload sub / email / roles / permissions 等
 * @param secret HS256 密钥（与 verifyToken 的 AUTH_HS256_SECRET 同源）
 * @param ttlSec 默认 86400
 */
export function signHS256(
  payload: SignPayload,
  secret: string,
  ttlSec = 86400,
): string {
  const iat = Math.floor(Date.now() / 1000)
  const full = { ...payload, iat, exp: iat + ttlSec }
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(full))
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest()
  return `${header}.${body}.${b64url(sig)}`
}
