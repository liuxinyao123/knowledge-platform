/**
 * OpenViking sidecar - 类型定义
 *
 * OpenViking REST API 的精简类型描述。我们只用其中很小一个子集：
 *   - POST /v1/write    写入一条 context（自动生成 L0/L1/L2）
 *   - POST /v1/find     语义检索 + 目录范围过滤
 *   - GET  /v1/read?uri 按 URI 读全文
 *   - GET  /v1/ls?path  列目录
 *   - GET  /healthz     健康检查
 *
 * 真实字段以 OpenViking 后端为准，这里只声明我们读写的部分。
 * 字段缺失/多出不影响运行（容错解析）。
 */

/** OpenViking URI 形如 viking://user/<id>/sessions/<sid>/<ts>.md */
export type VikingUri = string

/** 三层抽象 */
export interface VikingTiers {
  /** L0: 单句摘要 ~100 tokens */
  abstract?: string
  /** L1: 概览 ~2k tokens */
  overview?: string
  /** L2: 全文，按需读 */
  content?: string
}

export interface VikingFindHit {
  uri: VikingUri
  /** L1 概览，召回时一般直接给到这一层 */
  l1?: string
  /** L0 摘要 */
  l0?: string
  score?: number
  metadata?: Record<string, unknown>
}

export interface VikingFindResult {
  hits: VikingFindHit[]
}

export interface VikingWriteRequest {
  /** 必填 viking:// 路径 */
  uri: VikingUri
  /** 原始文本 / markdown */
  content: string
  /** 任意业务元数据，会落到该条记录上 */
  metadata?: Record<string, unknown>
}

export interface VikingWriteResult {
  uri: VikingUri
  ok: boolean
}

export interface VikingFindRequest {
  /** 自然语言查询 */
  query: string
  /** 限定路径前缀（必填，client 强制注入） */
  pathPrefix: VikingUri
  /** 取多少条 */
  topK?: number
  /** 默认 'l1'，避免传整段全文回来 */
  layer?: 'l0' | 'l1' | 'l2'
}

export interface VikingHealthResult {
  ok: boolean
  /** 后端版本，调试用 */
  version?: string
  /** 后端 reachable 但功能 degraded 时给个原因 */
  reason?: string
}
