import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import KnowledgeTabs from './KnowledgeTabs'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<KnowledgeTabs />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('KnowledgeTabs — active state', () => {
  it('marks 总览 tab active when at /overview', () => {
    renderAt('/overview')
    expect(screen.getByTestId('tab-overview')).toHaveClass('active')
  })

  it('marks 检索 tab active when at /search', () => {
    renderAt('/search')
    expect(screen.getByTestId('tab-search')).toHaveClass('active')
  })

  it('does not mark 总览 active when at /search', () => {
    renderAt('/search')
    expect(screen.getByTestId('tab-overview')).not.toHaveClass('active')
  })
})

describe('KnowledgeTabs — navigation', () => {
  it('renders all 7 tabs', () => {
    renderAt('/overview')
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument()
    expect(screen.getByTestId('tab-search')).toBeInTheDocument()
    expect(screen.getByTestId('tab-spaces')).toBeInTheDocument()
    expect(screen.getByTestId('tab-ingest')).toBeInTheDocument()
    expect(screen.getByTestId('tab-qa')).toBeInTheDocument()
    expect(screen.getByTestId('tab-governance')).toBeInTheDocument()
    expect(screen.getByTestId('tab-mcp')).toBeInTheDocument()
  })
})
