import type { ReactElement } from 'react'
import { LEGEND_ENTRIES } from './colors'

export default function NodeLegend(): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        padding: 10,
        background: '#f9fafb',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontSize: 12,
        marginBottom: 12,
      }}
    >
      {LEGEND_ENTRIES.map((e) => (
        <span key={e.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: e.color,
              display: 'inline-block',
            }}
          />
          {e.label}
        </span>
      ))}
    </div>
  )
}
