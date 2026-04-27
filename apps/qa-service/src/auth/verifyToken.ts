/**
 * auth/verifyToken.ts —— JWT 验签双栈
 *
 * 两种模式，二选一（env 配置）：
 *   AUTH_JWKS_URL       远端 JWKS（OIDC/Keycloak 场景）
 *   AUTH_HS256_SECRET   本地 HS256 对称密钥
 *
 * payload 约定：{ sub: number | string, email?: string, ... }
 * 返回标准化 Payload：{ user_id: number, email: string }
 *
 * 说明：本文件对外只暴露 verifyToken 与 isAuthConfigured。
 * 不引外部库，只用内置 crypto，覆盖 HS256 基本情形。JWKS 场景用 fetch + RS256。
 */
import crypto from 'node:crypto'

export interface TokenPayload {
  user_id: number
  email: string
  /** PRD §2.5: token 含 permissions 优先 */
  permissions?: string[]
  /** PRD §2.5: 否则展开 roles 经 ROLE_TO_PERMS */
  roles?: string[]
}

export class TokenError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'TokenError'
  }
}

export function authMode(): 'jwks' | 'hs256' | 'none' {
  if (process.env.AUTH_JWKS_URL?.trim()) return 'jwks'
  if (process.env.AUTH_HS256_SECRET?.trim()) return 'hs256'
  return 'none'
}

export function isAuthConfigured(): boolean {
  return authMode() !== 'none'
}

// ── base64url ────────────────────────────────────────────────────────────────

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? 0 : 4 - (input.length % 4)
  const b64 = (input + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64')
}

interface JwtParts {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signingInput: string
  signature: Buffer
}

function parseJwt(token: string): JwtParts {
  const parts = token.split('.')
  if (parts.length !== 3) throw new TokenError('malformed jwt')
  const [h64, p64, s64] = parts
  let header: Record<string, unknown>
  let payload: Record<string, unknown>
  try {
    header = JSON.parse(b64urlDecode(h64).toString('utf8'))
    payload = JSON.parse(b64urlDecode(p64).toString('utf8'))
  } catch {
    throw new TokenError('jwt parse failed')
  }
  return {
    header,
    payload,
    signingInput: `${h64}.${p64}`,
    signature: b64urlDecode(s64),
  }
}

// ── HS256 ────────────────────────────────────────────────────────────────────

function verifyHs256(parts: JwtParts, secret: string): void {
  if (parts.header.alg !== 'HS256') {
    throw new TokenError(`unsupported alg ${String(parts.header.alg)}`)
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(parts.signingInput)
    .digest()
  if (expected.length !== parts.signature.length
    || !crypto.timingSafeEqual(expected, parts.signature)) {
    throw new TokenError('bad signature')
  }
}

// ── JWKS（RS256）─────────────────────────────────────────────────────────────
// 轻量实现：按 kid 从 JWKS 拉公钥缓存 10 分钟

interface Jwk {
  kid: string; kty: string; n: string; e: string; alg?: string; use?: string
}

const jwksCache = new Map<string, { fetchedAt: number; keys: Jwk[] }>()
const JWKS_TTL_MS = 10 * 60 * 1000

async function getJwks(url: string): Promise<Jwk[]> {
  const cached = jwksCache.get(url)
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys
  const res = await fetch(url)
  if (!res.ok) throw new TokenError(`jwks fetch ${res.status}`)
  const data = await res.json() as { keys?: Jwk[] }
  const keys = data.keys ?? []
  jwksCache.set(url, { fetchedAt: Date.now(), keys })
  return keys
}

function jwkToPem(jwk: Jwk): crypto.KeyObject {
  // 仅支持 RSA；EC 未包含
  return crypto.createPublicKey({
    key: {
      kty: jwk.kty, n: jwk.n, e: jwk.e,
    } as unknown as crypto.JsonWebKey,
    format: 'jwk',
  })
}

async function verifyJwks(parts: JwtParts, url: string): Promise<void> {
  if (parts.header.alg !== 'RS256') {
    throw new TokenError(`unsupported alg ${String(parts.header.alg)}`)
  }
  const kid = String(parts.header.kid ?? '')
  const keys = await getJwks(url)
  const jwk = keys.find((k) => k.kid === kid) ?? keys[0]
  if (!jwk) throw new TokenError('jwk not found')
  const pub = jwkToPem(jwk)
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(parts.signingInput),
    pub,
    parts.signature,
  )
  if (!ok) throw new TokenError('bad signature')
}

// ── exp / nbf / iat 基础校验 ─────────────────────────────────────────────────

function checkTimeClaims(payload: Record<string, unknown>): void {
  const now = Math.floor(Date.now() / 1000)
  const exp = typeof payload.exp === 'number' ? payload.exp : undefined
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : undefined
  if (exp != null && now >= exp) throw new TokenError('token expired')
  if (nbf != null && now < nbf) throw new TokenError('token not yet valid')
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

export async function verifyToken(token: string): Promise<TokenPayload> {
  if (!token) throw new TokenError('empty token')
  const parts = parseJwt(token)

  const mode = authMode()
  if (mode === 'hs256') {
    verifyHs256(parts, process.env.AUTH_HS256_SECRET!)
  } else if (mode === 'jwks') {
    await verifyJwks(parts, process.env.AUTH_JWKS_URL!)
  } else {
    throw new TokenError('auth not configured')
  }

  checkTimeClaims(parts.payload)

  const sub = parts.payload.sub
  const user_id = typeof sub === 'number' ? sub : Number(sub)
  if (!Number.isFinite(user_id)) throw new TokenError('invalid sub claim')
  const email = typeof parts.payload.email === 'string' ? parts.payload.email : ''
  const permissions = Array.isArray(parts.payload.permissions)
    ? (parts.payload.permissions as unknown[]).filter((p): p is string => typeof p === 'string')
    : undefined
  const roles = Array.isArray(parts.payload.roles)
    ? (parts.payload.roles as unknown[]).filter((r): r is string => typeof r === 'string')
    : undefined
  return { user_id, email, permissions, roles }
}
