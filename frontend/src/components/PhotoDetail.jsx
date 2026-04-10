import { useEffect, useRef, useState } from 'react'

export default function PhotoDetail({ photo, onClose, apiBase }) {
  const imgRef = useRef(null)
  const [imgBox, setImgBox] = useState(null) // {w, h} of the rendered <img>
  const [hover, setHover] = useState(null)

  // Track the rendered <img> size so we can scale bbox coordinates.
  useEffect(() => {
    setImgBox(null)
  }, [photo.path])

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
  }, [photo.path])

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

  const boxClass = (d) => {
    if (!d.is_match) return 'bbox bbox-other'
    if (d.confidence === 'high') return 'bbox bbox-high'
    if (d.confidence === 'medium') return 'bbox bbox-medium'
    return 'bbox bbox-low'
  }

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="detail-content">
          <div className="detail-image">
            <div className="image-frame">
              <img
                ref={imgRef}
                src={`${apiBase}/api/image?path=${encodeURIComponent(photo.path)}`}
                alt={photo.filename}
              />
              {sx > 0 && detections.map((d, i) => (
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
            </div>
          </div>

          <div className="detail-info">
            <h2>{photo.filename}</h2>
            <p className="detail-path">{photo.path}</p>

            <div className={`detection-badge ${photo.detected ? 'positive' : 'negative'}`}>
              {photo.detected
                ? `${matches.length} weed${matches.length === 1 ? '' : 's'} detected`
                : (detections.length > 0 ? `${detections.length} purple blob(s) — none confirmed` : 'Clean')}
            </div>

            {matches.length > 0 && (
              <div className="detection-list">
                <h3>Confirmed</h3>
                <ul>
                  {matches.map((d, i) => (
                    <li key={i}>
                      <span className={`confidence-${d.confidence}`}>●</span>{' '}
                      <strong>{d.species || 'unknown'}</strong>
                      {' '}<small>({d.confidence})</small>
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
                    <li key={i}>{d.species || 'unknown'} — {d.description}</li>
                  ))}
                  {nonMatches.length > 5 && <li>… and {nonMatches.length - 5} more</li>}
                </ul>
              </div>
            )}

            <div className="detail-status">
              <span>Status: {photo.status}</span>
              {photo.width && photo.height && (
                <span>{photo.width} × {photo.height}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
