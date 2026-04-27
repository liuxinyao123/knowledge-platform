/**
 * OpenViking sidecar - 统一入口
 *
 * 业务代码只 import 这里。
 *
 * 例：
 *   import { recallMemory, saveMemory, isEnabled } from '../../services/viking/index.ts'
 */

export { isEnabled, health } from './client.ts'
export {
  recallMemory,
  saveMemory,
  formatRecallAsContext,
  type RecallParams,
  type RecallResult,
  type SaveParams,
  type SaveResult,
} from './memoryAdapter.ts'
export type {
  VikingFindHit,
  VikingHealthResult,
  VikingUri,
} from './types.ts'
