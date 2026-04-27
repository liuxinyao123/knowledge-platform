/**
 * graphInsights/keys.ts —— 稳定哈希，跨重算保持同一条洞察的 identity。
 *
 * 设计 D-006：
 *   - isolated : sha256('iso:' + asset_id)
 *   - bridge   : sha256('bri:' + asset_id)
 *   - surprise : sha256('sur:' + min(a,b) + ':' + max(a,b))
 *   - sparse   : sha256('spa:' + sorted(asset_ids).join(','))
 *
 * 注意：sparse 的 key 在社区成员变化时会变——这是预期行为（"当时的那个稀疏社区"）。
 */
import { createHash } from 'node:crypto'

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function isolatedKey(assetId: number): string {
  return sha256Hex(`iso:${assetId}`)
}

export function bridgeKey(assetId: number): string {
  return sha256Hex(`bri:${assetId}`)
}

export function surpriseKey(aId: number, bId: number): string {
  const [a, b] = aId < bId ? [aId, bId] : [bId, aId]
  return sha256Hex(`sur:${a}:${b}`)
}

export function sparseKey(assetIds: number[]): string {
  const sorted = [...assetIds].sort((x, y) => x - y).join(',')
  return sha256Hex(`spa:${sorted}`)
}
