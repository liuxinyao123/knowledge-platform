/**
 * agent/fuse.ts —— 结果融合
 *
 * Phase 1：passthrough（不改事件）。预留接口给未来多 Agent 聚合。
 */
import type { EmitFn } from '../ragTypes.ts'

export function passthroughEmit(downstream: EmitFn): EmitFn {
  return (evt) => downstream(evt)
}
