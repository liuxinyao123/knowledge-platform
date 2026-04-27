/**
 * services/fileSource/crypto.ts —— 对称加密（AES-256-GCM）
 *
 * 密文格式：`"<iv_base64>:<ct_base64>:<tag_base64>"`
 * Key：env `MASTER_ENCRYPT_KEY`，64 hex chars（= 32 bytes）。缺失时抛 MasterEncryptKeyMissing。
 *
 * 只加密 config_json 里名为 password / secret / access_key_secret 的字段；
 * 字段名从 `password` 改为 `password_enc`（或 `secret_enc` 等）落库。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { MasterEncryptKeyMissing } from './types.ts'
// (only class import; no types from this file)

const ENC_FIELD_SUFFIX = '_enc'
const SECRET_KEYS = new Set(['password', 'secret', 'access_key_secret'])

function loadKey(): Buffer {
  const hex = process.env.MASTER_ENCRYPT_KEY
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) throw new MasterEncryptKeyMissing()
  return Buffer.from(hex, 'hex')
}

export function encryptString(plain: string): string {
  const key = loadKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`
}

export function decryptString(blob: string): string {
  const key = loadKey()
  const parts = blob.split(':')
  if (parts.length !== 3) throw new Error('invalid ciphertext format (expected "iv:ct:tag")')
  const [ivB64, ctB64, tagB64] = parts
  const iv  = Buffer.from(ivB64,  'base64')
  const ct  = Buffer.from(ctB64,  'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** 遍历 config_json，给 secret 字段加密 + 改名为 <field>_enc；非 secret 字段原样保留 */
export function encryptConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config }
  for (const k of Object.keys(config)) {
    if (SECRET_KEYS.has(k) && typeof config[k] === 'string' && config[k] !== '') {
      out[`${k}${ENC_FIELD_SUFFIX}`] = encryptString(config[k] as string)
      delete out[k]
    }
  }
  return out
}

/** 遍历 config_json，把 <field>_enc 解密回 <field>；未命中的字段不动 */
export function decryptConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config }
  for (const k of Object.keys(config)) {
    if (k.endsWith(ENC_FIELD_SUFFIX)) {
      const base = k.slice(0, -ENC_FIELD_SUFFIX.length)
      if (SECRET_KEYS.has(base) && typeof config[k] === 'string') {
        out[base] = decryptString(config[k] as string)
        delete out[k]
      }
    }
  }
  return out
}

/** API 返回前 redact：加密字段名保留 `_enc`，值替换为 `***`；明文 secret 字段（不应出现，兜底）也 `***` */
export function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config }
  for (const k of Object.keys(config)) {
    if (SECRET_KEYS.has(k)) {
      delete out[k]
      out[`${k}${ENC_FIELD_SUFFIX}`] = '***'
    } else if (k.endsWith(ENC_FIELD_SUFFIX)) {
      out[k] = '***'
    }
  }
  return out
}

/** 调用方合并 PATCH 时使用：如果 patch 里没提供 secret 字段，保留旧密文 */
export function mergeConfigForPatch(
  oldStored: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...oldStored }
  for (const k of Object.keys(patch)) {
    const v = patch[k]
    if (SECRET_KEYS.has(k)) {
      // secret 字段如果 patch 里是空串 / 未提供 / undefined → 保留旧密文
      if (typeof v === 'string' && v !== '' && v !== '***') {
        const enc = encryptString(v)
        merged[`${k}${ENC_FIELD_SUFFIX}`] = enc
        delete merged[k]
      }
      // 否则跳过，旧 *_enc 保留
    } else {
      merged[k] = v
    }
  }
  return merged
}
