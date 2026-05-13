// Skeleton loaders — substituem spinners por placeholders que preservam o layout.
// Animação leve via CSS (sem JS).

export function SkeletonLine({ className = '', width }) {
  return (
    <span
      className={`inline-block h-3 rounded bg-white/10 animate-pulse ${className}`}
      style={width ? { width } : undefined}
    />
  );
}

export function SkeletonBox({ className = '' }) {
  return <div className={`rounded-2xl bg-white/5 animate-pulse ${className}`} />;
}

export function SkeletonRow({ cols = 4 }) {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <SkeletonLine width={`${60 + (i % 3) * 20}%`} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTable({ rows = 6, cols = 4 }) {
  return (
    <table className="w-full">
      <tbody>
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonRow key={i} cols={cols} />
        ))}
      </tbody>
    </table>
  );
}

export function SkeletonStats({ count = 4 }) {
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-${count} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBox key={i} className="h-24" />
      ))}
    </div>
  );
}

export function SkeletonList({ items = 5 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 animate-pulse">
          <div className="w-10 h-10 rounded-xl bg-white/10 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 rounded bg-white/10" style={{ width: '70%' }} />
            <div className="h-2 rounded bg-white/10" style={{ width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
