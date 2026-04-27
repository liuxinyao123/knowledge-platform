/**
 * services/passwordHash.ts —— Node 内置 crypto.scrypt 密码哈希
 *
 * 格式：`scrypt$<salt-hex>$<hash-hex>`
 * 不引 bcrypt（避免沙箱 / CI native binding 问题）。
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>

const SALT_BYTES = 16
const HASH_BYTES = 64

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 1) {
    throw new Error('password required')
  }
  const salt = randomBytes(SALT_BYTES).toString('hex')
  const derived = await scryptAsync(password, salt, HASH_BYTES)
  return `scrypt$${salt}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, hashHex] = parts
  const derived = await scryptAsync(password, salt, HASH_BYTES)
  const expected = Buffer.from(hashHex, 'hex')
  if (expected.length !== derived.length) return false
  return timingSafeEqual(expected, derived)
}
