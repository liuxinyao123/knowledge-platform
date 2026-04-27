/**
 * IngestConfigPanel —— /ingest 右侧统一「入库配置」面板
 *
 * 2026-04-23-26 space-permissions 改造：
 *  - 目标空间改用新 `space` 实体（/api/spaces），不再把 metadata_source 名字当作空间
 *  - 两级 dropdown：先选空间（或"不关联空间"→ 老 org 级语义），再选该空间下的数据源
 *  - 数据层写入仍以 sourceId 为准（后端 ingest 契约不变），spaceId 只决定可见的 source 候选
 *
 * 受控：父组件持有 state 并把 onChange 传下来。
 */
import { useEffect, useState } from 'react'
import { listPgSources, type PgSourceRow } from '@/api/assetDirectory'
import { listSpaces, listSpaceSources, type SpaceSummary } from '@/api/spaces'
import type { IngestOptions } from '@/api/ingest'

export type Strategy = 'heading' | 'fixed' | 'smart'

export interface IngestConfig {
  /** 显示用的 "空间名"（发给后端当 job 摘要里的 space 标签；与 spaceId 解耦以兼容老链路） */
  space: string
  /** 2026-04-23-26：新 space 实体 id；null = 不关联空间（org 级入库） */
  spaceId: number | null
  sourceId: number
  tagsRaw: string         // 逗号分隔的原文，用户输入用
  strategy: Strategy
  vectorize: boolean
}

export const DEFAULT_INGEST_CONFIG: IngestConfig = {
  space: '未关联空间',
  spaceId: null,
  sourceId: 1,
  tagsRaw: '',
  strategy: 'heading',
  vectorize: true,
}

export function configToOptions(cfg: IngestConfig): IngestOptions {
  const tags = cfg.tagsRaw.split(',').map((s) => s.trim()).filter(Boolean)
  return {
    space: cfg.space,
    sourceId: cfg.sourceId,
    tags,
    strategy: cfg.strategy,
    vectorize: cfg.vectorize,
  }
}

interface Props {
  value: IngestConfig
  onChange: (next: IngestConfig) => void
  /** 紧凑模式下不渲染外框 padding */
  embedded?: boolean
}

const STRATEGY_LABEL: Record<Strategy, string> = {
  heading: '按标题/段落',
  fixed:   '固定长度',
  smart:   '智能切分',
}

export default function IngestConfigPanel({ value, onChange, embedded }: Props) {
  const [spaces, setSpaces] = useState<SpaceSummary[]>([])
  const [allSources, setAllSources] = useState<PgSourceRow[]>([])
  // 当前选中空间下的 source id 子集（null = 未选空间，显示 allSources）
  const [scopedSourceIds, setScopedSourceIds] = useState<Set<number> | null>(null)

  // 挂载：拉空间 + 全部数据源
  useEffect(() => {
    Promise.all([listSpaces(), listPgSources()])
      .then(([sp, sr]) => {
        setSpaces(sp)
        setAllSources(sr)
        // 默认数据源兜底
        if (sr.length > 0 && !sr.some((s) => s.id === value.sourceId)) {
          onChange({ ...value, sourceId: sr[0].id, space: sr[0].name })
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 当选中空间变化：拉该空间下的 source 集合
  useEffect(() => {
    if (value.spaceId == null) {
      setScopedSourceIds(null)
      return
    }
    listSpaceSources(value.spaceId, 'none')
      .then((groups) => {
        const ids = new Set<number>()
        for (const g of groups) for (const s of g.sources) ids.add(s.id)
        setScopedSourceIds(ids)
      })
      .catch(() => setScopedSourceIds(new Set()))
  }, [value.spaceId])

  // 当前可选 source 列表
  const visibleSources: PgSourceRow[] = scopedSourceIds == null
    ? allSources
    : allSources.filter((s) => scopedSourceIds.has(s.id))

  // 若当前 sourceId 不在可见列表内，自动修正到第一条
  useEffect(() => {
    if (visibleSources.length === 0) return
    if (!visibleSources.some((s) => s.id === value.sourceId)) {
      const first = visibleSources[0]
      onChange({ ...value, sourceId: first.id, space: first.name })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.spaceId, scopedSourceIds])

  const selectedSpace = spaces.find((sp) => sp.id === value.spaceId) ?? null

  const wrap: React.CSSProperties = embedded
    ? { display: 'flex', flexDirection: 'column', gap: 14 }
    : {
        background: '#fff', border: '1px solid var(--border)', borderRadius: 12,
        padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
      }

  return (
    <div style={wrap} data-testid="ingest-config">
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>入库配置</div>

      {/* 目标空间 + 数据源：两列 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <Label>目标空间</Label>
          <select
            value={value.spaceId == null ? '' : String(value.spaceId)}
            onChange={(e) => {
              const raw = e.target.value
              const nextSpaceId = raw === '' ? null : Number(raw)
              const nextSpace = nextSpaceId == null
                ? '未关联空间'
                : (spaces.find((sp) => sp.id === nextSpaceId)?.name ?? value.space)
              onChange({ ...value, spaceId: nextSpaceId, space: nextSpace })
            }}
            style={fieldStyle}
            data-testid="cfg-space"
          >
            <option value="">— 不关联空间（org 级） —</option>
            {spaces.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.visibility === 'private' ? '🔒 ' : '📁 '}{sp.name}
                {sp.source_count ? `（${sp.source_count} 源）` : ''}
              </option>
            ))}
          </select>
          {selectedSpace && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              所有者：{selectedSpace.owner_email} · 我是：
              {({ owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '查看者' } as const)[selectedSpace.my_role ?? 'viewer']}
            </div>
          )}
        </div>
        <div>
          <Label>数据源</Label>
          <select
            value={String(value.sourceId)}
            onChange={(e) => {
              const sid = Number(e.target.value)
              const matched = allSources.find((s) => s.id === sid)
              onChange({ ...value, sourceId: sid, space: matched?.name ?? value.space })
            }}
            style={fieldStyle}
            data-testid="cfg-source"
            disabled={visibleSources.length === 0}
          >
            {visibleSources.length === 0 && (
              <option value="">
                {value.spaceId != null ? '该空间下暂无数据源' : '暂无数据源'}
              </option>
            )}
            {visibleSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.asset_count ? `（${s.asset_count}）` : ''}
              </option>
            ))}
          </select>
          {value.spaceId != null && visibleSources.length === 0 && (
            <div style={{ fontSize: 11, color: '#B45309', marginTop: 4 }}>
              该空间还没关联任何数据源，先去「空间 → {selectedSpace?.name} → 关联数据源」再来入库
            </div>
          )}
        </div>
      </div>

      {/* 标签独占一行 */}
      <div>
        <Label>标签（逗号分隔）</Label>
        <input
          type="text"
          value={value.tagsRaw}
          placeholder="治理, SOP, 指标"
          onChange={(e) => onChange({ ...value, tagsRaw: e.target.value })}
          style={fieldStyle}
          data-testid="cfg-tags"
        />
      </div>

      {/* 分段策略 pill 组 */}
      <div>
        <Label>分段策略</Label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['heading', 'fixed', 'smart'] as Strategy[]).map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`cfg-strategy-${s}`}
              onClick={() => onChange({ ...value, strategy: s })}
              className={`pill${value.strategy === s ? ' active' : ''}`}
            >
              {STRATEGY_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {/* 向量化 toggle */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        paddingTop: 4, borderTop: '1px dashed var(--border)',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>向量化索引</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            用于相似检索与问答引用
          </div>
        </div>
        <Toggle
          checked={value.vectorize}
          onChange={(v) => onChange({ ...value, vectorize: v })}
        />
      </div>
    </div>
  )
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 13,
  background: '#fff',
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase',
      letterSpacing: 0.4, marginBottom: 4,
    }}>{children}</div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid="cfg-vectorize"
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 999,
        background: checked ? 'var(--p, #6C47FF)' : '#d1d5db',
        border: 'none', position: 'relative', cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      <span style={{
        display: 'block', width: 16, height: 16, borderRadius: '50%',
        background: '#fff', position: 'absolute', top: 3,
        left: checked ? 21 : 3, transition: 'left 0.15s',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
      }} />
    </button>
  )
}
