/**
 * SpaceDetailPane —— 右侧主区 stack
 *   - SpaceInfoCard
 *   - SpaceMembersTable
 *   - SpaceDirectoryList
 *
 * 数据：父组件传入已加载的 SpaceDetail + members，stale-while-revalidate 由父层管
 */
import { useState } from 'react'
import type { SpaceDetail, SpaceMember } from '@/api/spaces'
import SpaceInfoCard from './SpaceInfoCard'
import SpaceMembersTable from './SpaceMembersTable'
import SpaceDirectoryList from './SpaceDirectoryList'
import EditSpaceModal from './EditSpaceModal'

interface Props {
  space: SpaceDetail
  members: SpaceMember[]
  onChanged: () => void
  onAttachSource: () => void
}

export default function SpaceDetailPane({ space, members, onChanged, onAttachSource }: Props) {
  const [editing, setEditing] = useState(false)
  const canEdit = space.my_role === 'owner' || space.my_role === 'admin'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <SpaceInfoCard space={space} onEdit={() => setEditing(true)} canEdit={canEdit} />
      <SpaceMembersTable
        spaceId={space.id}
        members={members}
        myRole={space.my_role}
        currentOwner={space.owner_email}
        onChanged={onChanged}
      />
      <SpaceDirectoryList
        spaceId={space.id}
        canEdit={canEdit}
        onAttachSource={onAttachSource}
      />
      {editing && (
        <EditSpaceModal
          space={space}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChanged() }}
        />
      )}
    </div>
  )
}
