export default function ScanProgress({ progress }) {
  const { status, total, processed, detected, current_file } = progress
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0
  const isDone = status === 'complete' || status === 'cancelled' || status === 'error'

  const statusLabel = {
    scanning: `Scanning...`,
    complete: 'Complete',
    cancelled: 'Cancelled',
    error: 'Error',
  }[status] ?? status

  return (
    <div className="progress-panel">
      <div className="progress-stats">
        <span>{statusLabel} — {processed} / {total} photos</span>
        <span className="detected-count">{detected} detected</span>
        {current_file && !isDone && (
          <span className="current-file" title={current_file}>{current_file}</span>
        )}
      </div>
      <div className="progress-bar">
        <div
          className={`progress-fill${status === 'complete' ? ' complete' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
