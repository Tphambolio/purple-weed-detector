import { useEffect, useRef, useState } from 'react'

const SPECIES_PICKER = [
  { value: 'purple_loosestrife', label: 'Purple Loosestrife' },
  { value: 'thistle',            label: 'Thistle' },
  { value: 'dames_rocket',       label: "Dame's Rocket" },
  { value: 'other',              label: 'Other purple weed' },
]

export default function PhotoDetail({ photo, onClose, onVerdict, onClearVerdict }) {
  const imgRef = useRef(null)
  const [imgBox, setImgBox] = useState(null)
  const [hover, setHover] = useState(null)
  const [selectedBox, setSelectedBox] = useState(null)
  const [showSpeciesPicker, setShowSpeciesPicker] = useState(false)

  useEffect(() => {
    setImgBox(null)
    setSelectedBox(null)
    setShowSpeciesPicker(false)
  }, [photo.hash])

  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    const update = () => setImgBox({ w: el.clientWidth, h: el.clientHeight })
    if (el.complete) update()
    el.addEventListener('load', update)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('load', update)
      ro.disconnect()
    }
  }, [photo.hash])

  const detections = photo.detections || []
  const matches = detections.filter(d => d.is_match)
  const nonMatches = detections.filter(d => !d.is_match)

  const sx = imgBox && photo.width ? imgBox.w / photo.width : 0
  const sy = imgBox && photo.height ? imgBox.h / photo.height : 0

  const boxStyle = (d) => ({
    left: `${d.x * sx}px`,
    top: `${d.y * sy}px`,
    width: `${d.w * sx}px`,
    height: `${d.h * sy}px`,
  })

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

  const selectBox = (i) => {
    setSelectedBox(i)
    setShowSpeciesPicker(false)
  }

  const handleCorrect = () => {
    if (selectedBox == null) return
    onVerdict?.(photo, selectedBox, { human_verdict: 'correct' })
    setShowSpeciesPicker(false)
  }
  const handleWrongSpecies = () => {
    setShowSpeciesPicker(true)
  }
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

  // Keyboard shortcuts when a bbox is selected.
  useEffect(() => {
    if (selectedBox == null) return
    const handler = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') {
        setSelectedBox(null)
        setShowSpeciesPicker(false)
        e.preventDefault()
      } else if (e.key === '1') {
        handleCorrect()
        e.preventDefault()
      } else if (e.key === '2') {
        handleWrongSpecies()
        e.preventDefault()
      } else if (e.key === '3') {
        handleNotAWeed()
        e.preventDefault()
      } else if (e.key === 'ArrowRight') {
        setSelectedBox(i => (i + 1) % detections.length)
        setShowSpeciesPicker(false)
        e.preventDefault()
      } else if (e.key === 'ArrowLeft') {
        setSelectedBox(i => (i - 1 + detections.length) % detections.length)
        setShowSpeciesPicker(false)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBox, detections.length])

  const selectedDet = selectedBox != null ? detections[selectedBox] : null

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="detail-content">
          <div className="detail-image">
            <div className="image-frame">
              <img ref={imgRef} src={photo.previewUrl} alt={photo.filename} />
              {sx > 0 && detections.map((d, i) => (
                <div
                  key={i}
                  className={boxClass(d, i)}
                  style={boxStyle(d)}
                  onClick={(e) => { e.stopPropagation(); selectBox(i) }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  title={`${d.species || 'unknown'} (${d.confidence || '?'})`}
                >
                  {hover === i && selectedBox !== i && (
                    <span className="bbox-label">
                      {d.species || 'unknown'} · {d.confidence || '?'}
                    </span>
                  )}
                </div>
              ))}
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
                  Shortcuts: 1 correct · 2 wrong species · 3 not a weed · ←/→ cycle · Esc deselect
                </div>
              </div>
            )}

            {matches.length > 0 && (
              <div className="detection-list">
                <h3>Confirmed</h3>
                <ul>
                  {matches.map((d, i) => (
                    <li key={i}>
                      <span className={`confidence-${d.confidence}`}>●</span>{' '}
                      <strong>{d.species || 'unknown'}</strong>
                      {' '}<small>({d.confidence})</small>
                      {d.human_verdict && <span className="verdict-tag"> ✓ verified</span>}
                      {d.description && <div className="muted">{d.description}</div>}
                      <div className="muted small">
                        ({d.cx}, {d.cy}) · {d.area_px} px
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {nonMatches.length > 0 && (
              <div className="detection-list">
                <h3>Other purple objects ({nonMatches.length})</h3>
                <ul className="muted small">
                  {nonMatches.slice(0, 5).map((d, i) => (
                    <li key={i}>
                      {d.species || 'unknown'} — {d.description}
                      {d.human_verdict && <span className="verdict-tag"> ✗ verified</span>}
                    </li>
                  ))}
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
