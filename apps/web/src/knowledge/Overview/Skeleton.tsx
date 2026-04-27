export function MetricCardsSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          data-testid="metric-skeleton"
          className="animate-pulse bg-gray-200 rounded-lg h-24"
        />
      ))}
    </>
  )
}

export function ListRowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse bg-gray-200 rounded-lg h-9" />
      ))}
    </div>
  )
}
