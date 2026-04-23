import { useEffect, useRef, useState } from 'react'
import AnnotationCanvas, { WEED_SPECIES } from './AnnotationCanvas'
import { saveAnnotation, getAnnotationsForImage, deleteAnnotation } from '../lib/db'

const SPECIES_LABEL = Object.fromEntries(WEED_SPECIES.map(s => [s.value, s.label]))

export default function PhotoDetail({ photo, onClose }) {
  const imgRef  = useRef(null)
  const [imgBox, setImgBox]         = useState(null)
  const [hover, setHover]           = useState(null)
  const [annotating, setAnnotating] = useState(false)
  const [savedAnnotations, setSavedAnnotations] = useState([])

  // Reset on photo change
  useEffect(() => {
    setImgBox(null)
    setAnnotating(false)
    getAnnotationsForImage(photo.hash).then(setSavedAnnotations)
  }, [photo.hash])

  // Track displayed image size
  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    const update = () => setImgBox({ w: el.clientWidth, h: el.clientHeight })
    if (el.complete) update()
    el.addEventListener('load', update)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { el.removeEventListener('load', update); ro.disconnect() }
  }, [photo.hash])

  const handleSaveAnnotation = async (annotation) => {
    const id = await saveAnnotation(annotation)
    setSavedAnnotations(prev => [...prev, { ...annotation, id, created_at: new Date().toISOString() }])
    setAnnotating(false)
  }

  const handleDeleteAnnotation = async (id) => {
    await deleteAnnotation(id)
    setSavedAnnotations(prev => prev.filter(a => a.id !== id))
  }

  const detections  = photo.detections || []
  const matches     = detections.filter(d => d.is_match)
  const nonMatches  = detections.filter(d => !d.is_match)

  const sx = imgBox && photo.width  ? imgBox.w / photo.width  : 0
  const sy = imgBox && photo.height ? imgBox.h / photo.height : 0

  const boxStyle = (d) => ({
    left:   `${d.x * sx}px`,
    top:    `${d.y * sy}px`,
    width:  `${d.w * sx}px`,
    height: `${d.h * sy}px`,
  })

  const boxClass = (d) => {
    if (!d.is_match) return 'bbox bbox-other'
    if (d.confidence === 'high')   return 'bbox bbox-high'
    if (d.confidence === 'medium') return 'bbox bbox-medium'
    return 'bbox bbox-low'
  }

  const savedBoxStyle = (a) => ({
    left:   `${a.displayRect.x}px`,
    top:    `${a.displayRect.y}px`,
    width:  `${a.displayRect.w}px`,
    height: `${a.displayRect.h}px`,
  })

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="detail-content">
          <div className="detail-image">
            <div className="image-frame">
              <img ref={imgRef} src={photo.previewUrl} alt={photo.filename} />

              {/* AI detection boxes — hidden while annotating */}
              {sx > 0 && !annotating && detections.map((d, i) => (
                <div
                  key={i}
                  className={boxClass(d)}
                  style={boxStyle(d)}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  title={`${d.species || 'unknown'} (${d.confidence || '?'})`}
                >
                  {hover === i && (
                    <span className="bbox-label">
                      {d.species || 'unknown'} · {d.confidence || '?'}
                    </span>
                  )}
                </div>
              ))}

              {/* Saved manual annotation overlays */}
              {sx > 0 && !annotating && savedAnnotations.map(a => (
                a.displayRect && (
                  <div
                    key={a.id}
                    className="bbox bbox-confirmed"
                    style={savedBoxStyle(a)}
                    title={SPECIES_LABEL[a.species] || a.species}
                  >
                    <span className="bbox-label confirmed-label">
                      {SPECIES_LABEL[a.species] || a.species} ✓
                    </span>
                  </div>
                )
              ))}

              {/* Annotation draw canvas */}
              {sx > 0 && (
                <AnnotationCanvas
                  imgRef={imgRef}
                  imgBox={imgBox}
                  photo={photo}
                  annotating={annotating}
                  onSave={handleSaveAnnotation}
                />
              )}
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

            {/* Annotate toggle */}
            <button
              className={`btn-annotate${annotating ? ' active' : ''}`}
              onClick={() => setAnnotating(a => !a)}
              disabled={!photo.width || !photo.height}
            >
              {annotating ? '✕ Cancel draw' : '+ Annotate weed'}
            </button>
            {annotating && (
              <p className="hint">Drag a rectangle around the weed, then pick species.</p>
            )}

            {/* Saved manual IDs */}
            {savedAnnotations.length > 0 && (
              <div className="detection-list">
                <h3>Confirmed IDs ({savedAnnotations.length})</h3>
                <ul>
                  {savedAnnotations.map(a => (
                    <li key={a.id} className="confirmed-id-row">
                      {a.crop && <img className="confirmed-crop" src={a.crop} alt={a.species} />}
                      <div className="confirmed-id-meta">
                        <strong>{SPECIES_LABEL[a.species] || a.species}</strong>
                        <div className="muted small">{new Date(a.created_at).toLocaleDateString()}</div>
                      </div>
                      <button
                        className="confirmed-id-delete"
                        onClick={() => handleDeleteAnnotation(a.id)}
                        title="Remove"
                      >✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {matches.length > 0 && (
              <div className="detection-list">
                <h3>AI Detections</h3>
                <ul>
                  {matches.map((d, i) => (
                    <li key={i}>
                      <span className={`confidence-${d.confidence}`}>●</span>{' '}
                      <strong>{d.species || 'unknown'}</strong>
                      {' '}<small>({d.confidence})</small>
                      {d.description && <div className="muted">{d.description}</div>}
                      <div className="muted small">({d.cx}, {d.cy}) · {d.area_px} px</div>
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
                    <li key={i}>{d.species || 'unknown'} — {d.description}</li>
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
