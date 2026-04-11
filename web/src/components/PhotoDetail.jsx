import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const SPECIES_PICKER = [
  { value: 'purple_loosestrife', label: 'Purple Loosestrife' },
  { value: 'thistle',            label: 'Thistle' },
  { value: 'dames_rocket',       label: "Dame's Rocket" },
  { value: 'other',              label: 'Other purple weed' },
]

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
    } else if (!d.is_match) {
      classes.push('bbox-other')
    } else if (d.confidence === 'high') {
      classes.push('bbox-high')
    } else if (d.confidence === 'medium') {
      classes.push('bbox-medium')
    } else {
      classes.push('bbox-low')
    }
    if (d.inherited_from_verdict_id) classes.push('bbox-inherited')
    if (selectedBox === idx) classes.push('bbox-active')
    return classes.join(' ')
  }
  const boxStyle = (d) => ({
    left: `${d.x}px`,
    top: `${d.y}px`,
    width: `${d.w}px`,
    height: `${d.h}px`,
    // Keep the outline ~2px on screen regardless of zoom.
    borderWidth: `${2 / zoom}px`,
  })

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
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="detail-content">
          <div className="detail-image">
            <div
              ref={containerRef}
              className="zoom-viewport"
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
            >
              <div
                className="zoom-canvas"
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
                  style={{
                    width: `${photo.width || 0}px`,
                    height: `${photo.height || 0}px`,
                    display: 'block',
                    imageRendering: zoom >= 2 ? 'pixelated' : 'auto',
                    userSelect: 'none',
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

              <div className="zoom-controls" onMouseDown={e => e.stopPropagation()}>
                <button onClick={() => {
                  const rect = containerRef.current?.getBoundingClientRect()
                  if (rect) zoomAtPoint(rect.width / 2, rect.height / 2, 1.25)
                }} title="Zoom in (+)">＋</button>
                <button onClick={() => {
                  const rect = containerRef.current?.getBoundingClientRect()
                  if (rect) zoomAtPoint(rect.width / 2, rect.height / 2, 1 / 1.25)
                }} title="Zoom out (−)">−</button>
                <button onClick={fitToContainer} title="Fit to view (0)">Fit</button>
                <span className="zoom-pct">{zoomPct}%</span>
              </div>

              <div className="zoom-hint">Scroll to zoom · drag to pan · click a bbox to inspect</div>
            </div>
          </div>

          <div className="detail-info">
            <h2>{photo.filename}</h2>
            <p className="detail-path">{photo.width} × {photo.height}</p>

            <div className={`detection-badge ${photo.detected ? 'positive' : 'negative'}`}>
              {photo.detected
                ? `${matches.length} weed${matches.length === 1 ? '' : 's'} detected`
                : (detections.length > 0 ? `${detections.length} purple blob(s) — none confirmed` : 'Clean')}
            </div>

            {selectedDet && (
              <div className="verdict-panel">
                <h3>Verify detection #{selectedBox + 1}</h3>
                <div className="verdict-ai-readout">
                  <strong>{selectedDet.species || 'unknown'}</strong>{' '}
                  <small>({selectedDet.confidence || '?'})</small>
                  {selectedDet.description && (
                    <div className="muted">{selectedDet.description}</div>
                  )}
                  <div className="muted small">
                    {selectedDet.w}×{selectedDet.h} px at ({selectedDet.cx}, {selectedDet.cy})
                  </div>
                </div>
                <div className="verdict-actions">
                  <button
                    className={`weed-btn${selectedDet.human_verdict === 'correct' ? ' active' : ''}`}
                    onClick={handleCorrect}
                    title="Press 1"
                  >
                    Correct
                  </button>
                  <button
                    className={`weed-btn${selectedDet.human_verdict === 'wrong_species' ? ' active' : ''}`}
                    onClick={handleWrongSpecies}
                    title="Press 2"
                  >
                    Wrong species
                  </button>
                  <button
                    className={`weed-btn${selectedDet.human_verdict === 'not_a_plant' ? ' active' : ''}`}
                    onClick={handleNotAWeed}
                    title="Press 3"
                  >
                    Not a weed
                  </button>
                </div>
                {showSpeciesPicker && (
                  <div className="verdict-species-picker">
                    <div className="muted small">Pick the actual species:</div>
                    <div className="weed-options">
                      {SPECIES_PICKER.map(opt => (
                        <button
                          key={opt.value}
                          className="weed-btn"
                          onClick={() => handlePickSpecies(opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {selectedDet.human_verdict && (
                  <button className="link-btn" onClick={handleClearVerdict}>
                    Clear verdict
                  </button>
                )}
                <div className="muted small verdict-shortcuts">
                  1 correct · 2 wrong species · 3 not a weed · ←/→ cycle · Esc deselect · +/− zoom · 0 fit
                </div>
              </div>
            )}

            {matches.length > 0 && (
              <div className="detection-list">
                <h3>Confirmed</h3>
                <ul>
                  {matches.map((d, i) => {
                    const origIdx = detections.indexOf(d)
                    return (
                      <li key={i} className="clickable" onClick={() => selectBox(origIdx)}>
                        <span className={`confidence-${d.confidence}`}>●</span>{' '}
                        <strong>{d.species || 'unknown'}</strong>
                        {' '}<small>({d.confidence})</small>
                        {d.human_verdict && <span className="verdict-tag"> ✓ verified</span>}
                        {d.description && <div className="muted">{d.description}</div>}
                        <div className="muted small">
                          ({d.cx}, {d.cy}) · {d.area_px} px
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {nonMatches.length > 0 && (
              <div className="detection-list">
                <h3>Other purple objects ({nonMatches.length})</h3>
                <ul className="muted small">
                  {nonMatches.slice(0, 5).map((d, i) => {
                    const origIdx = detections.indexOf(d)
                    return (
                      <li key={i} className="clickable" onClick={() => selectBox(origIdx)}>
                        {d.species || 'unknown'} — {d.description}
                        {d.human_verdict && <span className="verdict-tag"> ✗ verified</span>}
                      </li>
                    )
                  })}
                  {nonMatches.length > 5 && <li>… and {nonMatches.length - 5} more</li>}
                </ul>
              </div>
            )}

            <div className="detail-status">
              <span>Status: {photo.status}</span>
              {photo.fromCache && <span>(from cache)</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
