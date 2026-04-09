export default function FolderInput({
  folder, setFolder,
  selectedWeeds, setSelectedWeeds,
  weedOptions, onScan, onCancel, scanning,
}) {
  const toggleWeed = (value) => {
    if (value === 'any') {
      setSelectedWeeds(['any'])
      return
    }
    setSelectedWeeds(prev => {
      const filtered = prev.filter(w => w !== 'any')
      if (filtered.includes(value)) {
        const next = filtered.filter(w => w !== value)
        return next.length === 0 ? ['any'] : next
      }
      return [...filtered, value]
    })
  }

  return (
    <div className="scan-panel">
      <div className="input-group">
        <label>Photo Folder Path</label>
        <input
          type="text"
          value={folder}
          onChange={e => setFolder(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !scanning && folder && onScan()}
          placeholder="/path/to/photos"
          className="folder-input"
          disabled={scanning}
          spellCheck={false}
        />
      </div>

      <div className="weed-select">
        <label>Target Species</label>
        <div className="weed-options">
          {weedOptions.map(opt => (
            <button
              key={opt.value}
              className={`weed-btn${selectedWeeds.includes(opt.value) ? ' active' : ''}`}
              onClick={() => toggleWeed(opt.value)}
              disabled={scanning}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="scan-actions">
        {scanning ? (
          <button className="btn-danger" onClick={onCancel}>Cancel</button>
        ) : (
          <button className="btn-primary" onClick={onScan} disabled={!folder.trim()}>
            Start Scan
          </button>
        )}
      </div>
    </div>
  )
}
