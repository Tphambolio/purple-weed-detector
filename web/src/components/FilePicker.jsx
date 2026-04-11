import { useMemo, useRef, useState } from 'react'
import { SPECIES, groupByColorClass } from '../lib/species.js'
import { COLOR_CLASSES, COLOR_CLASS_ORDER } from '../lib/colorClasses.js'
import { isSpeciesActive } from '../lib/phenology.js'
import { formatDateSource } from '../lib/exif.js'

export default function FilePicker({
  files, setFiles,
  openFileChooser,
  selectedSpeciesIds, setSelectedSpeciesIds,
  photoDate, photoDateSource, onPhotoDateOverride,
  inSeasonOnly, setInSeasonOnly,
  onScan, onCancel, scanning,
  hasResults, onReset,
  fewShotEnabled, setFewShotEnabled,
}) {
  const dateInputRef = useRef(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetClearCache, setResetClearCache] = useState(false)

  const groups = useMemo(() => groupByColorClass(SPECIES), [])
  const selectedSet = useMemo(() => new Set(selectedSpeciesIds), [selectedSpeciesIds])
  const dateForBloomCheck = photoDate || new Date()

  const toggleSpecies = (id) => {
    setSelectedSpeciesIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return Array.from(next)
    })
  }

  const selectAll = () => setSelectedSpeciesIds(SPECIES.map(s => s.id))
  const selectNone = () => setSelectedSpeciesIds([])
  const selectInSeason = () => {
    const active = SPECIES.filter(s => isSpeciesActive(s, dateForBloomCheck))
    setSelectedSpeciesIds(active.map(s => s.id))
  }

  const cancelReset = () => { setResetConfirm(false); setResetClearCache(false) }
  const confirmReset = async () => {
    await onReset?.({ clearAnalysisCache: resetClearCache })
    cancelReset()
  }

  const handleDateOverride = (e) => {
    const v = e.target.value
    if (!v) return
    onPhotoDateOverride?.(new Date(v + 'T12:00:00'))
  }

  const totalSelected = selectedSpeciesIds.length
  const photoDateStr = photoDate ? photoDate.toISOString().slice(0, 10) : ''

  return (
    <div className="h-full flex flex-col text-on-surface">
      {/* ── Photos block ────────────────────────────────────── */}
      <div className="p-5 space-y-3">
        <h3 className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/60">Source Data</h3>
        <div className="p-4 rounded-xl bg-surface-container-lowest space-y-3">
          <button
            onClick={openFileChooser}
            disabled={scanning}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-br from-primary to-primary-container text-on-primary-container py-2.5 rounded-lg font-bold text-sm shadow-lg hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-lg">add_photo_alternate</span>
            Choose photos
          </button>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter ${
              files.length > 0
                ? 'bg-tertiary-container/20 text-tertiary'
                : 'bg-surface-container-high text-on-surface-variant/50'
            }`}>
              {files.length === 0 ? 'No files' : `${files.length} file${files.length === 1 ? '' : 's'} ready`}
            </span>
            {photoDate && (
              <div className="flex items-center gap-1 text-[11px] text-on-surface-variant/80">
                <span className="material-symbols-outlined text-sm">calendar_today</span>
                <span>{photoDateStr}</span>
                <button
                  onClick={() => dateInputRef.current?.showPicker?.() || dateInputRef.current?.focus()}
                  disabled={scanning}
                  className="text-primary/70 hover:text-primary text-[10px] underline-offset-2 hover:underline ml-1"
                >
                  override
                </button>
              </div>
            )}
            <input
              ref={dateInputRef}
              type="date"
              value={photoDateStr}
              onChange={handleDateOverride}
              className="absolute opacity-0 pointer-events-none w-0 h-0"
              disabled={scanning}
            />
          </div>
          {photoDate && (
            <div className="text-[10px] text-on-surface-variant/40 italic">
              {formatDateSource(photoDateSource)}
            </div>
          )}
        </div>
      </div>

      {/* ── Target Species (scrollable) ──────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-4">
        <div className="flex items-center justify-between sticky top-0 bg-surface-container-low pt-1 pb-2 -mx-1 px-1 z-10">
          <h3 className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/60">
            Target Species <span className="text-on-surface-variant/40">({totalSelected})</span>
          </h3>
          <div className="flex gap-3 text-[10px] font-bold text-primary">
            <button onClick={selectInSeason} disabled={scanning} className="hover:underline">In-season</button>
            <button onClick={selectAll} disabled={scanning} className="hover:underline opacity-60">All</button>
            <button onClick={selectNone} disabled={scanning} className="hover:underline opacity-60">None</button>
          </div>
        </div>

        <label className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-container hover:bg-surface-container-high cursor-pointer transition-colors">
          <input
            type="checkbox"
            checked={!!inSeasonOnly}
            onChange={e => setInSeasonOnly?.(e.target.checked)}
            disabled={scanning}
            className="w-4 h-4 rounded accent-primary cursor-pointer"
          />
          <span className="text-xs font-medium">In-season only (auto from photo date)</span>
        </label>

        <div className="space-y-4">
          {COLOR_CLASS_ORDER.map(clsId => {
            const cls = COLOR_CLASSES[clsId]
            const speciesInClass = groups[clsId] || []
            if (speciesInClass.length === 0) return null
            const selectedInClass = speciesInClass.filter(s => selectedSet.has(s.id)).length
            return (
              <div key={clsId} className="space-y-2">
                <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-wider"
                     style={{ color: cls.bbox_color + 'cc' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cls.bbox_color }} />
                  <span>{cls.label}</span>
                  <span className="text-on-surface-variant/40 normal-case font-medium tracking-normal">
                    {selectedInClass}/{speciesInClass.length}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {speciesInClass.map(sp => {
                    const active = selectedSet.has(sp.id)
                    const inSeason = isSpeciesActive(sp, dateForBloomCheck)
                    return (
                      <button
                        key={sp.id}
                        onClick={() => toggleSpecies(sp.id)}
                        disabled={scanning}
                        title={`${sp.scientific}${inSeason ? '' : ' — out of season'}`}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                          active
                            ? 'bg-primary/15 text-primary-fixed-dim border border-primary/60'
                            : 'bg-surface-container-lowest text-on-surface-variant/60 border border-transparent hover:border-outline-variant/30'
                        } ${inSeason ? '' : 'opacity-40'} disabled:cursor-not-allowed`}
                      >
                        {sp.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Footer actions ──────────────────────────────────── */}
      <div className="p-5 space-y-3 bg-surface-container-lowest/40">
        <label className="flex items-center gap-2.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={!!fewShotEnabled}
            onChange={e => setFewShotEnabled?.(e.target.checked)}
            disabled={scanning}
            className="w-3.5 h-3.5 rounded accent-primary cursor-pointer"
          />
          <span className="text-[11px] text-on-surface-variant/80 font-medium">
            Use my verdicts for accuracy <em className="not-italic opacity-50">(extra cost)</em>
          </span>
        </label>

        {scanning ? (
          <button
            onClick={onCancel}
            className="w-full flex items-center justify-center gap-2 bg-error/15 text-error border border-error/30 py-3 rounded-lg font-bold text-sm hover:bg-error/25 transition-all"
          >
            <span className="material-symbols-outlined text-lg">stop</span>
            Cancel scan
          </button>
        ) : (
          <button
            onClick={onScan}
            disabled={files.length === 0 || totalSelected === 0}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary to-primary-container text-on-primary-container py-3 rounded-lg font-black tracking-wide shadow-2xl shadow-primary/10 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100"
            title={totalSelected === 0 ? 'Select at least one species' : ''}
          >
            <span className="material-symbols-outlined">rocket_launch</span>
            Start Scan
          </button>
        )}

        {!scanning && (files.length > 0 || hasResults) && !resetConfirm && (
          <button
            onClick={() => setResetConfirm(true)}
            className="w-full text-[11px] text-on-surface-variant/60 hover:text-on-surface-variant transition-colors"
          >
            ← Start over
          </button>
        )}

        {resetConfirm && (
          <div className="p-3 rounded-lg bg-surface-container-high space-y-2">
            <p className="text-xs font-semibold text-on-surface">Clear current session?</p>
            <label className="flex items-center gap-2 text-[11px] text-on-surface-variant cursor-pointer">
              <input
                type="checkbox"
                checked={resetClearCache}
                onChange={e => setResetClearCache(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-primary cursor-pointer"
              />
              <span>Also clear analysis cache</span>
            </label>
            <p className="text-[10px] text-on-surface-variant/40 italic">Verdicts and learning data are preserved.</p>
            <div className="flex gap-2">
              <button
                onClick={confirmReset}
                className="flex-1 px-2 py-1.5 rounded bg-error/20 text-error text-[11px] font-bold hover:bg-error/30"
              >
                Confirm
              </button>
              <button
                onClick={cancelReset}
                className="flex-1 px-2 py-1.5 rounded bg-surface-container-lowest text-on-surface-variant text-[11px] font-medium hover:bg-surface-container"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
