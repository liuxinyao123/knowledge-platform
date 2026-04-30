/**
 * /spaces —— 空间管理页（space-permissions, ADR 2026-04-23-26）
 *
 * 原型图布局（四块）：
 *   左：空间列表（含分组 + role pill）
 *   右主区：空间信息卡 / 成员与权限表 / 目录结构
 *   右上按钮：邀请成员（入口放成员表卡内）+ 导入知识（跳 /ingest）
 *
 * 旧 source→asset 树降级到 `/spaces/:id/tree`（通过 SpaceDirectoryList 的 "浏览资产树" 按钮进入）。
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import KnowledgeTabs from '@/components/KnowledgeTabs'
import {
  getSpace, listMembers, listSpaces,
  type SpaceDetail, type SpaceMember, type SpaceSummary,
} from '@/api/spaces'
import SpaceListPane from './SpaceListPane'
import SpaceDetailPane from './SpaceDetailPane'
import CreateSpaceModal from './CreateSpaceModal'
import AttachSourceModal from './AttachSourceModal'

export default function SpaceTree() {
  const navigate = useNavigate()
  const { t } = useTranslation('spaces')
  const { id: paramId } = useParams<{ id?: string }>()
  const [spaces, setSpaces] = useState<SpaceSummary[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(paramId ? Number(paramId) : null)
  const [detail, setDetail] = useState<SpaceDetail | null>(null)
  const [members, setMembers] = useState<SpaceMember[]>([])
  const [creating, setCreating] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [listErr, setListErr] = useState<string | null>(null)
  const [detailErr, setDetailErr] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    setLoadingList(true); setListErr(null)
    try {
      const items = await listSpaces()
      setSpaces(items)
      // 自动选第一个
      if (selectedId == null && items.length > 0) {
        setSelectedId(items[0].id)
      }
    } catch (e) {
      setListErr((e as Error).message)
    } finally {
      setLoadingList(false)
    }
  }, [selectedId])

  const loadDetail = useCallback(async (id: number) => {
    setDetail(null); setDetailErr(null)
    try {
      const [d, ms] = await Promise.all([getSpace(id), listMembers(id)])
      setDetail(d); setMembers(ms)
    } catch (e) {
      setDetailErr((e as Error).message)
    }
  }, [])

  useEffect(() => { void loadList() /* once */ }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedId != null) void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  function handleSelect(id: number) {
    setSelectedId(id)
    // 保持 URL 与选中同步，但不强制（原 /spaces 入口不带 id 时也可用）
    navigate(`/spaces/${id}`, { replace: true })
  }

  async function handleCreated(newId: number) {
    setCreating(false)
    await loadList()
    handleSelect(newId)
  }

  async function handleChanged() {
    // 改/删成员 / 编辑 / 删空间后统一刷新
    await loadList()
    if (selectedId != null) {
      // 若刚被删，loadDetail 会 404 —— 清空
      try { await loadDetail(selectedId) }
      catch { setSelectedId(null); setDetail(null) }
    }
  }

  const attachedSourceIds = new Set<number>()
  // SpaceDirectoryList 已自取数据；AttachSourceModal 过滤用这个集合会更准，
  // 但为了避免重复拉接口，这里保持空集（AttachSourceModal 内已按"排除已在空间里的"在后端侧幂等处理）

  return (
    <div className="page-body" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap',
      }}>
        <div>
          <div className="page-title">{t('title')}</div>
          <div className="page-sub">
            {t('subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/overview')}>{t('backToOverview')}</button>
          <button className="btn" onClick={() => setCreating(true)}>{t('newSpace')}</button>
          <button className="btn primary" onClick={() => navigate('/ingest')}>{t('importKnowledge')}</button>
        </div>
      </div>

      <KnowledgeTabs />

      <div className="split kc-spaces-split" style={{ flex: 1, minHeight: 520 }}>
        <div className="surface-card split-left panel" style={{ padding: 0 }}>
          <SpaceListPane
            spaces={spaces}
            selectedId={selectedId}
            onSelect={handleSelect}
            onCreate={() => setCreating(true)}
            loading={loadingList}
          />
          {listErr && (
            <div style={{ padding: 10, background: '#FEF2F2', color: '#B91C1C', fontSize: 12 }}>
              {listErr}
            </div>
          )}
        </div>

        <div className="surface-card split-right panel">
          <div className="panel-head">
            <div className="title">{detail ? detail.name : t('detailTitleFallback')}</div>
            {detail?.my_role && (
              <span style={{
                marginLeft: 8, padding: '1px 8px', fontSize: 11, borderRadius: 10,
                background: 'var(--p-light)', color: 'var(--p)',
              }}>
                {t('myRolePrefix')}{t(`roleLabels.${detail.my_role}`)}
              </span>
            )}
          </div>
          <div className="panel-body" style={{ padding: 0, overflowY: 'auto' }}>
            {detailErr && (
              <div style={{ padding: 16, color: '#B91C1C', fontSize: 13 }}>
                {detailErr}
              </div>
            )}
            {!detail && !detailErr && selectedId == null && (
              <div style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🗂️</div>
                <div style={{ fontSize: 13 }}>{t('selectHint')}</div>
              </div>
            )}
            {!detail && !detailErr && selectedId != null && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{t('loading')}</div>
            )}
            {detail && (
              <SpaceDetailPane
                space={detail}
                members={members}
                onChanged={() => void handleChanged()}
                onAttachSource={() => setAttaching(true)}
              />
            )}
          </div>
        </div>
      </div>

      {creating && (
        <CreateSpaceModal
          onClose={() => setCreating(false)}
          onCreated={(id) => void handleCreated(id)}
        />
      )}

      {attaching && detail && (
        <AttachSourceModal
          spaceId={detail.id}
          attachedIds={attachedSourceIds}
          onClose={() => setAttaching(false)}
          onAttached={() => { setAttaching(false); void handleChanged() }}
        />
      )}
    </div>
  )
}
