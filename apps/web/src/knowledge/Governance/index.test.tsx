import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/api/governance', () => ({
  govApi: {
    getUsers: vi.fn(),
    updateUserRole: vi.fn(),
    getShelfVisibility: vi.fn(),
    updateShelfVisibility: vi.fn(),
    // OQ-WEB-TEST-DEBT 修复（2026-04-25）：TagsPanel/DuplicatesPanel 等子组件
    // 在 mount 时调用更多 govApi 方法；缺一个就 TypeError 整个 tab 渲染挂掉
    listTags: vi.fn().mockResolvedValue({ items: [] }),
    mergeTags: vi.fn().mockResolvedValue({ ok: true }),
    listDuplicates: vi.fn().mockResolvedValue({ items: [] }),
    dismissDuplicate: vi.fn().mockResolvedValue({ ok: true }),
    listQuality: vi.fn().mockResolvedValue({ items: [] }),
    listAuditLog: vi.fn().mockResolvedValue({ items: [] }),
  },
}))

// OQ-WEB-TEST-DEBT 修复（2026-04-25）：
// space-permissions（ADR-26）后 SpacesTab 改读 listSpaces / updateSpace（@/api/spaces），
// 不再走 govApi.getShelfVisibility / updateShelfVisibility。test 之前 mock 错了 API。
vi.mock('@/api/spaces', () => ({
  listSpaces:  vi.fn().mockResolvedValue([]),
  updateSpace: vi.fn().mockResolvedValue({ ok: true }),
  listSpaceSources: vi.fn().mockResolvedValue([]),
}))

import { govApi } from '@/api/governance'
import { listSpaces, updateSpace } from '@/api/spaces'
import Governance from './index'

function renderGovernance() {
  return render(
    <MemoryRouter>
      <Governance />
    </MemoryRouter>
  )
}

beforeEach(() => vi.clearAllMocks())

describe('Governance — subtab navigation', () => {
  it('renders subtab buttons including spaces', () => {
    renderGovernance()
    expect(screen.getByTestId('subtab-knowledge')).toBeInTheDocument()
    expect(screen.getByTestId('subtab-members')).toBeInTheDocument()
    expect(screen.getByTestId('subtab-spaces')).toBeInTheDocument()
  })

  it('shows 知识治理 content by default', () => {
    renderGovernance()
    expect(screen.getByTestId('tab-content-knowledge')).toBeInTheDocument()
  })
})

describe('MembersTab', () => {
  beforeEach(() => {
    ;(govApi.getUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
      users: [{ id: 1, name: 'Alice', email: 'alice@x.com', role: 'admin', avatar_url: null }],
    })
  })

  it('clicking 成员管理 shows the panel', () => {
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-members'))
    expect(screen.getByTestId('tab-content-members')).toBeInTheDocument()
  })

  it('displays user name from govApi', async () => {
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-members'))
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
  })

  it('displays user email', async () => {
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-members'))
    await waitFor(() => expect(screen.getByText('alice@x.com')).toBeInTheDocument())
  })

  it('role select defaults to user role from govApi', async () => {
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-members'))
    await waitFor(() => {
      const select = screen.getByTestId('role-select-1') as HTMLSelectElement
      expect(select.value).toBe('admin')
    })
  })

  it('calls updateUserRole on save', async () => {
    ;(govApi.updateUserRole as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-members'))
    await waitFor(() => screen.getByTestId('role-select-1'))
    fireEvent.change(screen.getByTestId('role-select-1'), { target: { value: 'editor' } })
    fireEvent.click(screen.getByTestId('save-role-1'))
    await waitFor(() => expect(govApi.updateUserRole).toHaveBeenCalledWith(1, 'editor'))
  })
})

describe('SpacesTab', () => {
  beforeEach(() => {
    // OQ-WEB-TEST-DEBT (2026-04-25)：旧 test mock 的是 govApi.getShelfVisibility
    // （BookStack shelf 时代），ADR-26 之后 SpacesTab 改读 listSpaces。
    // SpaceVisibility 只接受 'org' | 'private'，'team' 已不是合法值。
    ;(listSpaces as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 10, slug: 'product', name: '产品', description: null,
        visibility: 'org', owner_email: 'a@x', my_role: 'owner',
        doc_count: 0, source_count: 0, member_count: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ])
  })

  it('displays shelf name', async () => {
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-spaces'))
    // OQ-WEB-TEST-DEBT (2026-04-25)：组件渲染 `📁 产品` / `🔒 产品`（emoji + 空格 + 名字），
    // 'getByText("产品")' 精确匹配会因 emoji 前缀失败。改 regex 部分匹配。
    await waitFor(() => expect(screen.getByText(/产品/)).toBeInTheDocument())
  })

  it('visibility select defaults to shelf visibility', async () => {
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-spaces'))
    await waitFor(() => {
      const select = screen.getByTestId('visibility-select-10') as HTMLSelectElement
      expect(select.value).toBe('org')
    })
  })

  it('calls updateSpace on save', async () => {
    ;(updateSpace as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })
    renderGovernance()
    fireEvent.click(screen.getByTestId('subtab-spaces'))
    await waitFor(() => screen.getByTestId('visibility-select-10'))
    fireEvent.change(screen.getByTestId('visibility-select-10'), { target: { value: 'private' } })
    fireEvent.click(screen.getByTestId('save-visibility-10'))
    await waitFor(() => expect(updateSpace).toHaveBeenCalledWith(10, { visibility: 'private' }))
  })
})
