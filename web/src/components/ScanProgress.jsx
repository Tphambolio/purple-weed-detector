export default function ScanProgress({ progress }) {
  const { status, total, processed, detected, current_file } = progress
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0
  const isDone = status === 'complete' || status === 'cancelled' || status === 'error'

  const statusLabel = {
    scanning: 'Scanning',
    complete: 'Complete',
    cancelled: 'Cancelled',
    error: 'Error',
  }[status] ?? status

  return (
    <div className="mb-4 p-4 rounded-xl bg-surface-container-low">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3 text-xs">
        <div className="flex items-center gap-2">
          {status === 'scanning' && (
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          )}
          {status === 'complete' && (
            <span className="material-symbols-outlined text-tertiary text-sm">check_circle</span>
          )}
          <span className="font-bold uppercase tracking-wider text-on-surface">{statusLabel}</span>
          <span className="text-on-surface-variant tabular-nums">{processed} / {total}</span>
        </div>
        <span className="text-tertiary font-bold tabular-nums">{detected} detected</span>
      </div>
      {current_file && !isDone && (
        <div className="text-[10px] text-on-surface-variant/60 mb-2 truncate font-mono" title={current_file}>
          {current_file}
        </div>
      )}
      <div className="h-1.5 bg-surface-container-lowest rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            status === 'complete'
              ? 'bg-tertiary'
              : 'bg-gradient-to-r from-primary to-primary-container'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
