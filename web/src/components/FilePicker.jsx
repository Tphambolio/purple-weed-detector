import { useEffect, useRef, useState } from 'react'

export default function FilePicker({
  files, setFiles,
  selectedWeeds, setSelectedWeeds,
  weedOptions, onScan, onCancel, scanning,
  hasResults, onReset, useProxy,
  fewShotEnabled, setFewShotEnabled,
}) {
  const inputRef = useRef(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetClearCache, setResetClearCache] = useState(false)
  const [resetClearPassword, setResetClearPassword] = useState(false)

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

  const showResetButton = !scanning && (files.length > 0 || hasResults) && !resetConfirm
  const showResetConfirm = !scanning && resetConfirm

  const cancelReset = () => {
    setResetConfirm(false)
    setResetClearCache(false)
    setResetClearPassword(false)
  }

  const confirmReset = async () => {
    await onReset?.({
      clearAnalysisCache: resetClearCache,
      clearPassword: resetClearPassword,
    })
    cancelReset()
    if (inputRef.current) inputRef.current.value = ''
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
        <label className="fewshot-toggle">
          <input
            type="checkbox"
            checked={!!fewShotEnabled}
            onChange={e => setFewShotEnabled?.(e.target.checked)}
            disabled={scanning}
          />
          <span>Use my verdicts to improve accuracy <em>(extra Gemini cost)</em></span>
        </label>
      </div>

      <div className="scan-actions">
        {scanning ? (
          <button className="btn-danger" onClick={onCancel}>Cancel</button>
        ) : (
          <>
            <button className="btn-primary" onClick={onScan} disabled={files.length === 0}>
              Start Scan
            </button>
            {showResetButton && (
              <button className="btn-secondary" onClick={() => setResetConfirm(true)}>
                Start Over
              </button>
            )}
          </>
        )}
      </div>

      {showResetConfirm && (
        <div className="reset-confirm">
          <p className="reset-confirm-title">Clear current session?</p>
          <label className="reset-checkbox">
            <input
              type="checkbox"
              checked={resetClearCache}
              onChange={e => setResetClearCache(e.target.checked)}
            />
            <span>Also clear analysis cache <em>(future scans re-hit Gemini)</em></span>
          </label>
          {useProxy && (
            <label className="reset-checkbox">
              <input
                type="checkbox"
                checked={resetClearPassword}
                onChange={e => setResetClearPassword(e.target.checked)}
              />
              <span>Also forget access password</span>
            </label>
          )}
          <p className="reset-note">Verdicts and learning data are preserved.</p>
          <div className="reset-actions">
            <button className="btn-danger" onClick={confirmReset}>Confirm reset</button>
            <button className="btn-secondary" onClick={cancelReset}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
