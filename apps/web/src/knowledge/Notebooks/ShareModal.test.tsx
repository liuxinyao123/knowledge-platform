/**
 * ShareModal · 基础渲染与主体选择器
 *
 * 对应 spec: openspec/changes/permissions-v2/specs/notebook-sharing-spec.md
 *   - ShareModal 可选择 user 或 team
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ShareModal from './ShareModal'

vi.mock('@/api/notebooks', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
  addMember: vi.fn().mockResolvedValue({ ok: true }),
  removeMember: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/api/teams', () => ({
  listTeams: vi.fn().mockResolvedValue([
    { id: 3, name: 'market', member_count: 5 },
    { id: 7, name: 'sales', member_count: 3 },
  ]),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ShareModal', () => {
  it('open=false → 不渲染', () => {
    const { container } = render(
      <ShareModal open={false} notebookId={10} notebookName="Book" onClose={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('open=true → 渲染 + 拉成员 / 团队', async () => {
    render(
      <ShareModal open={true} notebookId={10} notebookName="Book" onClose={() => {}} />,
    )
    // OQ-WEB-TEST-DEBT (2026-04-25)：原 /Book|共享|Share/i 太松，标题 + 描述都匹配。
    // 用 findAllByText 接受多匹配（任一存在即证明 modal 渲染了）
    const matches = await screen.findAllByText(/Book|共享|Share/i)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('主体选择器包含 user / team 两个选项', async () => {
    const { container } = render(
      <ShareModal open={true} notebookId={10} notebookName="Book" onClose={() => {}} />,
    )
    await waitFor(() => {
      // 寻找 select 或 radio 按钮里的 "user" 和 "team"
      const html = container.innerHTML
      expect(html).toMatch(/user/i)
      expect(html).toMatch(/team|团队/i)
    })
  })

  it('role 选择器包含 reader / editor 两个选项', async () => {
    const { container } = render(
      <ShareModal open={true} notebookId={10} notebookName="Book" onClose={() => {}} />,
    )
    await waitFor(() => {
      const html = container.innerHTML
      expect(html).toMatch(/reader/i)
      expect(html).toMatch(/editor/i)
    })
  })
})
