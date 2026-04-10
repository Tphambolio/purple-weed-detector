import { useState } from 'react'

export default function FolderInput({
  folder, setFolder,
  driveFolder, setDriveFolder,
  selectedWeeds, setSelectedWeeds,
  weedOptions, onScan, onScanDrive, onCancel, scanning,
}) {
  const [source, setSource] = useState('local') // 'local' | 'drive'

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

  const isLocal = source === 'local'
  const activeValue = isLocal ? folder : driveFolder
  const handleScan = isLocal ? onScan : onScanDrive

  return (
    <div className="scan-panel">
      <div className="source-tabs">
        <button
          className={`source-tab${isLocal ? ' active' : ''}`}
          onClick={() => setSource('local')}
          disabled={scanning}
        >
          Local Folder
        </button>
        <button
          className={`source-tab${!isLocal ? ' active' : ''}`}
          onClick={() => setSource('drive')}
          disabled={scanning}
        >
          Google Drive
        </button>
      </div>

      {isLocal ? (
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
      ) : (
        <div className="input-group">
          <label>Google Drive Folder URL or ID</label>
          <input
            type="text"
            value={driveFolder}
            onChange={e => setDriveFolder(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !scanning && driveFolder && onScanDrive()}
            placeholder="https://drive.google.com/drive/folders/1AbC...XyZ"
            className="folder-input"
            disabled={scanning}
            spellCheck={false}
          />
          <p className="hint">First scan opens a browser for Google sign-in.</p>
        </div>
      )}

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
          <button
            className="btn-primary"
            onClick={handleScan}
            disabled={!activeValue?.trim()}
          >
            Start Scan
          </button>
        )}
      </div>
    </div>
  )
}
