import { useMemo, useRef, useState } from 'react'
import { SPECIES, groupByColorClass } from '../lib/species.js'
import { COLOR_CLASSES, COLOR_CLASS_ORDER } from '../lib/colorClasses.js'
import { isSpeciesActive } from '../lib/phenology.js'
import { formatDateSource } from '../lib/exif.js'

export default function FilePicker({
  files, setFiles,
  selectedSpeciesIds, setSelectedSpeciesIds,
  photoDate, photoDateSource, onPhotoDateOverride,
  inSeasonOnly, setInSeasonOnly,
  onScan, onCancel, scanning,
  hasResults, onReset, useProxy,
  fewShotEnabled, setFewShotEnabled,
}) {
  const inputRef = useRef(null)
  const dateInputRef = useRef(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetClearCache, setResetClearCache] = useState(false)
  const [resetClearPassword, setResetClearPassword] = useState(false)
  const [collapsedClasses, setCollapsedClasses] = useState(() => new Set())

  const groups = useMemo(() => groupByColorClass(SPECIES), [])
  const selectedSet = useMemo(() => new Set(selectedSpeciesIds), [selectedSpeciesIds])
  const dateForBloomCheck = photoDate || new Date()

  const onChange = (e) => {
    const list = Array.from(e.target.files || []).filter(f => /^image\//.test(f.type))
    setFiles(list)
  }

  const toggleSpecies = (id) => {
    setSelectedSpeciesIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return Array.from(next)
    })
  }

  const toggleClass = (clsId) => {
    const classSpecies = groups[clsId] || []
    const allSelected = classSpecies.every(s => selectedSet.has(s.id))
    setSelectedSpeciesIds(prev => {
      const next = new Set(prev)
      if (allSelected) {
        for (const s of classSpecies) next.delete(s.id)
      } else {
        for (const s of classSpecies) next.add(s.id)
      }
      return Array.from(next)
    })
  }

  const collapseClass = (clsId) => {
    setCollapsedClasses(prev => {
      const next = new Set(prev)
      if (next.has(clsId)) next.delete(clsId)
      else next.add(clsId)
      return next
    })
  }

  const selectAll = () => setSelectedSpeciesIds(SPECIES.map(s => s.id))
  const selectNone = () => setSelectedSpeciesIds([])
  const selectInSeason = () => {
    const active = SPECIES.filter(s => isSpeciesActive(s, dateForBloomCheck))
    setSelectedSpeciesIds(active.map(s => s.id))
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

  const handleDateOverride = (e) => {
    const v = e.target.value
    if (!v) return
    onPhotoDateOverride?.(new Date(v + 'T12:00:00'))
  }

  const totalSelected = selectedSpeciesIds.length
  const photoDateStr = photoDate
    ? photoDate.toISOString().slice(0, 10)
    : ''

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
        {photoDate && (
          <div className="photo-date-row">
            <span className="photo-date-label">Photo date: <strong>{photoDateStr}</strong></span>
            <span className="photo-date-source muted small">{formatDateSource(photoDateSource)}</span>
            <button
              className="link-btn"
              onClick={() => dateInputRef.current?.showPicker?.() || dateInputRef.current?.focus()}
              disabled={scanning}
            >
              override
            </button>
            <input
              ref={dateInputRef}
              type="date"
              value={photoDateStr}
              onChange={handleDateOverride}
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
              disabled={scanning}
            />
          </div>
        )}
        <p className="hint">Photos are processed entirely in your browser. Nothing is uploaded except small crops sent to Gemini.</p>
      </div>

      <div className="weed-select">
        <div className="species-header">
          <label>Target Species <span className="muted small">({totalSelected} selected)</span></label>
          <div className="species-toolbar">
            <label className="inline-toggle" title="Auto-pre-select species in season for the photo date">
              <input
                type="checkbox"
                checked={!!inSeasonOnly}
                onChange={e => setInSeasonOnly?.(e.target.checked)}
                disabled={scanning}
              />
              <span>In-season only</span>
            </label>
            <button className="link-btn" onClick={selectInSeason} disabled={scanning}>In-season</button>
            <button className="link-btn" onClick={selectAll} disabled={scanning}>All</button>
            <button className="link-btn" onClick={selectNone} disabled={scanning}>None</button>
          </div>
        </div>

        <div className="species-groups">
          {COLOR_CLASS_ORDER.map(clsId => {
            const cls = COLOR_CLASSES[clsId]
            const classSpecies = groups[clsId] || []
            if (classSpecies.length === 0) return null
            const collapsed = collapsedClasses.has(clsId)
            const selectedInClass = classSpecies.filter(s => selectedSet.has(s.id)).length
            return (
              <div key={clsId} className="species-group">
                <div className="species-group-header" onClick={() => collapseClass(clsId)}>
                  <span className="color-dot" style={{ backgroundColor: cls.bbox_color }} />
                  <strong>{cls.label}</strong>
                  <span className="muted small">
                    {selectedInClass}/{classSpecies.length}
                  </span>
                  <button
                    className="link-btn"
                    onClick={(e) => { e.stopPropagation(); toggleClass(clsId) }}
                    disabled={scanning}
                    title="Toggle entire class"
                  >
                    {selectedInClass === classSpecies.length ? 'clear' : 'all'}
                  </button>
                  <span className="collapse-indicator">{collapsed ? '▸' : '▾'}</span>
                </div>
                {!collapsed && (
                  <div className="species-chips">
                    {classSpecies.map(sp => {
                      const active = selectedSet.has(sp.id)
                      const inSeason = isSpeciesActive(sp, dateForBloomCheck)
                      return (
                        <button
                          key={sp.id}
                          className={`species-chip${active ? ' active' : ''}${inSeason ? '' : ' out-of-season'}`}
                          onClick={() => toggleSpecies(sp.id)}
                          disabled={scanning}
                          title={`${sp.scientific}${inSeason ? '' : ' — out of season for photo date'}`}
                        >
                          <span className="color-dot small" style={{ backgroundColor: cls.bbox_color }} />
                          {sp.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
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
            <button
              className="btn-primary"
              onClick={onScan}
              disabled={files.length === 0 || totalSelected === 0}
              title={totalSelected === 0 ? 'Select at least one species to scan for' : ''}
            >
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
