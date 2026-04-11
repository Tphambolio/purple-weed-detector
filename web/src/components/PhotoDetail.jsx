import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SPECIES, groupByColorClass } from '../lib/species.js'
import { COLOR_CLASSES } from '../lib/colorClasses.js'

// Build the species picker for "wrong species" verdicts from the registry,
// grouped by colour class so the user can quickly find the right candidate.
const VERDICT_PICKER_GROUPS = (() => {
  const groups = groupByColorClass(SPECIES)
  return Object.entries(groups).map(([clsId, species]) => ({
    clsId,
    label: COLOR_CLASSES[clsId]?.label || clsId,
    color: COLOR_CLASSES[clsId]?.bbox_color || '#888',
    species: species.map(s => ({ value: s.id, label: s.label })),
  }))
})()

const MIN_ZOOM = 0.05
const MAX_ZOOM = 40

export default function PhotoDetail({ photo, onClose, onVerdict, onClearVerdict }) {
  const containerRef = useRef(null)
  const dragRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hover, setHover] = useState(null)
  const [selectedBox, setSelectedBox] = useState(null)
  const [showSpeciesPicker, setShowSpeciesPicker] = useState(false)

  const detections = photo.detections || []
  const matches = detections.filter(d => d.is_match)
  const nonMatches = detections.filter(d => !d.is_match)

  // ── Zoom / pan helpers ────────────────────────────────
  const fitToContainer = useCallback(() => {
    const c = containerRef.current
    if (!c || !photo.width || !photo.height) return
    const rect = c.getBoundingClientRect()
    const fit = Math.min(rect.width / photo.width, rect.height / photo.height)
    setZoom(fit)
    setPan({
      x: (rect.width - photo.width * fit) / 2,
      y: (rect.height - photo.height * fit) / 2,
    })
  }, [photo.width, photo.height])

  const zoomToBox = useCallback((d) => {
    const c = containerRef.current
    if (!c || !d) return
    const rect = c.getBoundingClientRect()
    // Fit bbox + 3× padding into the container
    const padW = Math.max(d.w, 40) * 4
    const padH = Math.max(d.h, 40) * 4
    const fit = Math.min(rect.width / padW, rect.height / padH)
    const scale = Math.max(1, Math.min(MAX_ZOOM, fit))
    const cx = d.x + d.w / 2
    const cy = d.y + d.h / 2
    setZoom(scale)
    setPan({
      x: rect.width / 2 - cx * scale,
      y: rect.height / 2 - cy * scale,
    })
  }, [])

  const zoomAtPoint = useCallback((screenX, screenY, factor) => {
    setZoom(prev => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * factor))
      const real = next / prev
      setPan(p => ({
        x: screenX - (screenX - p.x) * real,
        y: screenY - (screenY - p.y) * real,
      }))
      return next
    })
  }, [])

  // Fit on photo change (and reset selection).
  useLayoutEffect(() => {
    setSelectedBox(null)
    setShowSpeciesPicker(false)
    // Defer so the container has its final size.
    const id = requestAnimationFrame(fitToContainer)
    return () => cancelAnimationFrame(id)
  }, [photo.hash, fitToContainer])

  // Refit on window resize.
  useEffect(() => {
    const onResize = () => fitToContainer()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fitToContainer])

  // ── Mouse: wheel zoom + drag pan ──────────────────────
  // Attach wheel via a non-passive listener so we can preventDefault.
  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const onWheel = (e) => {
      e.preventDefault()
      const rect = c.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      zoomAtPoint(mx, my, factor)
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  }, [zoomAtPoint])

  const onMouseDown = (e) => {
    if (e.target.closest('.bbox')) return // let bbox handle click
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, moved: false }
  }
  const onMouseMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) d.moved = true
    setPan({ x: d.panX + dx, y: d.panY + dy })
  }
  const onMouseUp = () => { dragRef.current = null }

  // ── Bbox styling ──────────────────────────────────────
  const boxClass = (d, idx) => {
    const classes = ['bbox']
    if (d.human_verdict === 'correct' || (d.human_verdict === 'wrong_species' && d.is_match)) {
      classes.push('bbox-verified-correct')
    } else if (d.human_verdict === 'not_a_plant' || d.human_verdict === 'wrong_species') {
      classes.push('bbox-verified-wrong')
    }
    if (d.inherited_from_verdict_id) classes.push('bbox-inherited')
    if (selectedBox === idx) classes.push('bbox-active')
    return classes.join(' ')
  }
  // Default border colour comes from the detection's colour class so the user
  // can see at a glance which mask flagged each blob. Verdict states (correct/
  // wrong) override this via the bbox-verified-* CSS classes.
  const boxStyle = (d) => {
    const cls = d.color_class && COLOR_CLASSES[d.color_class]
    const baseColor = cls?.bbox_color || '#94a3b8'
    // Confidence drives opacity: low-confidence boxes are dimmer.
    const opacity = d.is_match
      ? 1
      : (d.confidence === 'high' ? 0.85 : d.confidence === 'medium' ? 0.65 : 0.45)
    return {
      left: `${d.x}px`,
      top: `${d.y}px`,
      width: `${d.w}px`,
      height: `${d.h}px`,
      borderColor: baseColor,
      borderStyle: d.is_match ? 'solid' : 'dashed',
      opacity,
      // Keep the outline ~2px on screen regardless of zoom.
      borderWidth: `${2 / zoom}px`,
    }
  }

  const selectBox = (i) => {
    setSelectedBox(i)
    setShowSpeciesPicker(false)
    zoomToBox(detections[i])
  }

  // ── Verdict handlers ──────────────────────────────────
  const handleCorrect = () => {
    if (selectedBox == null) return
    onVerdict?.(photo, selectedBox, { human_verdict: 'correct' })
    setShowSpeciesPicker(false)
  }
  const handleWrongSpecies = () => setShowSpeciesPicker(true)
  const handleNotAWeed = () => {
    if (selectedBox == null) return
    onVerdict?.(photo, selectedBox, { human_verdict: 'not_a_plant' })
    setShowSpeciesPicker(false)
  }
  const handlePickSpecies = (species) => {
    if (selectedBox == null) return
    onVerdict?.(photo, selectedBox, {
      human_verdict: 'wrong_species',
      human_species: species === 'other' ? 'not_a_plant' : species,
    })
    setShowSpeciesPicker(false)
  }
  const handleClearVerdict = () => {
    if (selectedBox == null) return
    onClearVerdict?.(photo, selectedBox)
    setShowSpeciesPicker(false)
  }

  // ── Keyboard shortcuts ────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      // Global shortcuts (always on)
      if (e.key === '+' || e.key === '=') {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) zoomAtPoint(rect.width / 2, rect.height / 2, 1.25)
        e.preventDefault(); return
      }
      if (e.key === '-' || e.key === '_') {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) zoomAtPoint(rect.width / 2, rect.height / 2, 1 / 1.25)
        e.preventDefault(); return
      }
      if (e.key === '0') { fitToContainer(); e.preventDefault(); return }
      // Selected-bbox shortcuts
      if (selectedBox == null) return
      if (e.key === 'Escape') {
        setSelectedBox(null); setShowSpeciesPicker(false); e.preventDefault()
      } else if (e.key === '1') { handleCorrect(); e.preventDefault() }
      else if (e.key === '2') { handleWrongSpecies(); e.preventDefault() }
      else if (e.key === '3') { handleNotAWeed(); e.preventDefault() }
      else if (e.key === 'ArrowRight') {
        const next = (selectedBox + 1) % detections.length
        selectBox(next); e.preventDefault()
      } else if (e.key === 'ArrowLeft') {
        const next = (selectedBox - 1 + detections.length) % detections.length
        selectBox(next); e.preventDefault()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBox, detections.length, fitToContainer, zoomAtPoint])

  const selectedDet = selectedBox != null ? detections[selectedBox] : null
  const zoomPct = Math.round(zoom * 100)

  return (
    <div className="fixed inset-0 z-[100] flex flex-col lg:flex-row bg-background/95 backdrop-blur-sm overflow-hidden" onClick={onClose}>
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-3 right-3 z-[110] w-10 h-10 rounded-full bg-surface-container-highest/60 hover:bg-surface-container-highest text-on-surface flex items-center justify-center transition-all active:scale-95"
      >
        <span className="material-symbols-outlined text-xl">close</span>
      </button>

      {/* ── Image viewport (left, 58% on desktop) ─────────────── */}
      <div
        className="flex-1 lg:w-[58%] lg:flex-initial relative bg-surface-container-lowest overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Subtle dot grid background */}
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(#33343b 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div
          ref={containerRef}
          className="relative w-full h-full overflow-hidden"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
        >
          <div
            className="absolute top-0 left-0 will-change-transform"
            style={{
              width: `${photo.width || 0}px`,
              height: `${photo.height || 0}px`,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            <img
              src={photo.previewUrl}
              alt={photo.filename}
              draggable={false}
              className="block select-none"
              style={{
                width: `${photo.width || 0}px`,
                height: `${photo.height || 0}px`,
                imageRendering: zoom >= 2 ? 'pixelated' : 'auto',
              }}
            />
            {detections.map((d, i) => (
              <div
                key={i}
                className={boxClass(d, i)}
                style={boxStyle(d)}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); selectBox(i) }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                title={`${d.species || 'unknown'} (${d.confidence || '?'})`}
              >
                {hover === i && selectedBox !== i && (
                  <span className="bbox-label" style={{ transform: `scale(${1 / zoom})`, transformOrigin: '0 100%' }}>
                    {d.species || 'unknown'} · {d.confidence || '?'}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Zoom controls — top-right floating HUD */}
          <div
            className="absolute top-4 left-4 lg:left-auto lg:right-20 flex items-center gap-1 bg-surface-container-low/85 backdrop-blur-xl p-1 rounded-lg shadow-xl"
            onMouseDown={e => e.stopPropagation()}
          >
            <button
              onClick={() => {
                const rect = containerRef.current?.getBoundingClientRect()
                if (rect) zoomAtPoint(rect.width / 2, rect.height / 2, 1 / 1.25)
              }}
              title="Zoom out (−)"
              className="p-2 hover:bg-surface-container-high rounded transition-colors text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-[18px]">remove</span>
            </button>
            <div className="px-3 text-xs font-semibold text-on-surface-variant tabular-nums w-12 text-center">
              {zoomPct}%
            </div>
            <button
              onClick={() => {
                const rect = containerRef.current?.getBoundingClientRect()
                if (rect) zoomAtPoint(rect.width / 2, rect.height / 2, 1.25)
              }}
              title="Zoom in (+)"
              className="p-2 hover:bg-surface-container-high rounded transition-colors text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
            </button>
            <button
              onClick={fitToContainer}
              title="Fit to view (0)"
              className="p-2 ml-1 hover:bg-surface-container-high rounded transition-colors text-on-surface flex items-center gap-1 px-3"
            >
              <span className="material-symbols-outlined text-[16px]">fullscreen_exit</span>
              <span className="text-[10px] font-bold uppercase tracking-wider">Fit</span>
            </button>
          </div>

          <div className="absolute bottom-4 left-4 text-[10px] font-mono text-on-surface-variant/60 hidden md:block">
            {photo.width} × {photo.height} px · scroll = zoom · drag = pan · click bbox = inspect
          </div>
        </div>
      </div>

      {/* ── Right metadata panel (42% on desktop, scrolls below on mobile) ─── */}
      <div
        className="lg:w-[42%] flex-shrink-0 h-full bg-surface-container-low overflow-y-auto flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-tight text-on-surface truncate">{photo.filename}</h1>
              <p className="text-xs text-on-surface-variant/70">{photo.width} × {photo.height} · {photo.status}</p>
            </div>
            <span className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wide ${
              photo.detected
                ? 'bg-tertiary-container/20 text-tertiary'
                : 'bg-surface-container-high text-on-surface-variant'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${photo.detected ? 'bg-tertiary' : 'bg-on-surface-variant'}`} />
              {photo.detected
                ? `${matches.length} detected`
                : (detections.length > 0 ? `${detections.length} candidates` : 'Clean')}
            </span>
          </div>

          {photo.class_counts && Object.keys(photo.class_counts).length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {Object.entries(photo.class_counts).map(([clsId, count]) => {
                const cls = COLOR_CLASSES[clsId]
                if (!cls) return null
                return (
                  <div key={clsId} className="px-3 py-1 bg-surface-container-high rounded-full flex items-center gap-1.5 text-xs">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cls.bbox_color }} />
                    <span className="font-semibold tabular-nums">{count}</span>
                    <span className="text-on-surface-variant/60 text-[10px]">{cls.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex-1 px-6 pb-6 space-y-6">
          {/* ── Verdict panel for the active bbox ─────────────── */}
          {selectedDet && (
            <section className="bg-surface-container-high p-5 rounded-xl border-l-4" style={{ borderColor: COLOR_CLASSES[selectedDet.color_class]?.bbox_color || '#888' }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-primary">{selectedDet.species || 'Unknown'}</h2>
                  <p className="text-[10px] font-bold text-tertiary uppercase tracking-widest mt-0.5">
                    {selectedDet.confidence || 'unknown'} confidence
                  </p>
                  {selectedDet.description && (
                    <p className="text-xs text-on-surface-variant/80 mt-2 leading-relaxed">{selectedDet.description}</p>
                  )}
                  <p className="text-[10px] text-on-surface-variant/40 mt-2 font-mono">
                    {selectedDet.w}×{selectedDet.h} px @ ({selectedDet.cx}, {selectedDet.cy})
                  </p>
                </div>
                <span className="material-symbols-outlined text-primary-container text-2xl">psychiatry</span>
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleCorrect}
                  className={`w-full flex items-center justify-between p-3 rounded-lg font-bold text-sm transition-all active:scale-95 ${
                    selectedDet.human_verdict === 'correct'
                      ? 'bg-gradient-to-r from-primary to-primary-container text-on-primary shadow-lg shadow-primary/10'
                      : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container'
                  }`}
                  title="Press 1"
                >
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg">check_circle</span>
                    Correct
                  </span>
                  <span className="text-[10px] opacity-70 px-1.5 rounded font-mono uppercase">1</span>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleWrongSpecies}
                    className={`flex items-center justify-center gap-1.5 p-2.5 rounded-lg text-xs font-semibold transition-all ${
                      selectedDet.human_verdict === 'wrong_species'
                        ? 'bg-secondary/20 text-secondary'
                        : 'bg-surface-container-lowest text-on-surface hover:text-secondary'
                    }`}
                    title="Press 2"
                  >
                    <span className="material-symbols-outlined text-secondary text-base">swap_horiz</span>
                    Wrong species
                  </button>
                  <button
                    onClick={handleNotAWeed}
                    className={`flex items-center justify-center gap-1.5 p-2.5 rounded-lg text-xs font-semibold transition-all ${
                      selectedDet.human_verdict === 'not_a_plant'
                        ? 'bg-error/20 text-error'
                        : 'bg-surface-container-lowest text-on-surface hover:text-error'
                    }`}
                    title="Press 3"
                  >
                    <span className="material-symbols-outlined text-error text-base">close</span>
                    Not a weed
                  </button>
                </div>
              </div>

              {showSpeciesPicker && (
                <div className="mt-4 pt-4 border-t border-outline-variant/15 space-y-3">
                  <div className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/60">
                    Pick actual species
                  </div>
                  {VERDICT_PICKER_GROUPS.map(grp => (
                    <div key={grp.clsId} className="space-y-1.5">
                      <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-wider"
                           style={{ color: grp.color + 'cc' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: grp.color }} />
                        {grp.label}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {grp.species.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => handlePickSpecies(opt.value)}
                            className="px-2 py-0.5 rounded-full text-[10px] bg-surface-container-lowest text-on-surface-variant hover:bg-primary/15 hover:text-primary border border-transparent hover:border-primary/40 transition-all"
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => handlePickSpecies('not_a_plant')}
                    className="w-full px-2 py-1.5 rounded text-[10px] bg-surface-container-lowest text-on-surface-variant hover:text-error transition-colors"
                  >
                    Not a plant / other
                  </button>
                </div>
              )}

              {selectedDet.human_verdict && (
                <button
                  onClick={handleClearVerdict}
                  className="mt-3 text-[11px] text-on-surface-variant/60 hover:text-on-surface-variant underline-offset-2 hover:underline"
                >
                  Clear verdict
                </button>
              )}

              <div className="mt-4 flex items-center justify-center gap-3 text-[9px] text-on-surface-variant/40 font-mono uppercase tracking-tight">
                <span><kbd className="px-1 rounded bg-surface-container-lowest">1</kbd> correct</span>
                <span><kbd className="px-1 rounded bg-surface-container-lowest">2</kbd> wrong</span>
                <span><kbd className="px-1 rounded bg-surface-container-lowest">3</kbd> not weed</span>
                <span><kbd className="px-1 rounded bg-surface-container-lowest">←→</kbd> cycle</span>
              </div>
            </section>
          )}

          {/* ── Confirmed list ─────────────────────────────────── */}
          {matches.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60">
                  Confirmed ({matches.length})
                </h3>
              </div>
              <div className="space-y-1">
                {matches.map((d, i) => {
                  const origIdx = detections.indexOf(d)
                  const cls = COLOR_CLASSES[d.color_class]
                  return (
                    <button
                      key={i}
                      onClick={() => selectBox(origIdx)}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface-container-high text-left transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cls?.bbox_color || '#888' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{d.species || 'unknown'}</p>
                        <p className="text-[10px] text-on-surface-variant/60">
                          {d.confidence} · ({d.cx}, {d.cy}) · {d.area_px}px
                        </p>
                      </div>
                      {d.human_verdict && (
                        <span className="material-symbols-outlined text-tertiary text-sm">verified</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* ── Other / non-match list ─────────────────────────── */}
          {nonMatches.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60">
                Other candidates ({nonMatches.length})
              </h3>
              <div className="space-y-1">
                {nonMatches.slice(0, 8).map((d, i) => {
                  const origIdx = detections.indexOf(d)
                  const cls = COLOR_CLASSES[d.color_class]
                  return (
                    <button
                      key={i}
                      onClick={() => selectBox(origIdx)}
                      className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-surface-container-high text-left transition-colors opacity-70 hover:opacity-100"
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cls?.bbox_color || '#888' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] truncate">{d.species || 'unknown'}</p>
                      </div>
                      {d.human_verdict && (
                        <span className="material-symbols-outlined text-error text-sm">close</span>
                      )}
                    </button>
                  )
                })}
                {nonMatches.length > 8 && (
                  <p className="text-[10px] text-on-surface-variant/40 italic px-2">… and {nonMatches.length - 8} more</p>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
