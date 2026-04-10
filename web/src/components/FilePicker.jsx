import { useRef } from 'react'

export default function FilePicker({
  files, setFiles,
  selectedWeeds, setSelectedWeeds,
  weedOptions, onScan, onCancel, scanning,
}) {
  const inputRef = useRef(null)

  const toggleWeed = (value) => {
    if (value === 'any') { setSelectedWeeds(['any']); return }
    setSelectedWeeds(prev => {
      const filtered = prev.filter(w => w !== 'any')
      if (filtered.includes(value)) {
        const next = filtered.filter(w => w !== value)
        return next.length === 0 ? ['any'] : next
      }
      return [...filtered, value]
    })
  }

  const onChange = (e) => {
    const list = Array.from(e.target.files || []).filter(f => /^image\//.test(f.type))
    setFiles(list)
  }

  return (
    <div className="scan-panel">
      <div className="input-group">
        <label>Photos</label>
        <div className="file-row">
          <button
            className="btn-secondary"
            onClick={() => inputRef.current?.click()}
            disabled={scanning}
          >
            Choose photos…
          </button>
          <span className="file-count">
            {files.length === 0 ? 'No files selected' : `${files.length} file${files.length === 1 ? '' : 's'} ready`}
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={onChange}
        />
        <p className="hint">Photos are processed entirely in your browser. Nothing is uploaded except small crops sent to Gemini.</p>
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
          <button className="btn-primary" onClick={onScan} disabled={files.length === 0}>
            Start Scan
          </button>
        )}
      </div>
    </div>
  )
}
