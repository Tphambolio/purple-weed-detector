import { useState } from 'react'

export default function PhotoGallery({ results, selected, onSelect, apiBase }) {
  const [tab, setTab] = useState('detected')

  const detected = results.filter(r => r.detected === true)
  const clean = results.filter(r => r.detected === false)
  const errors = results.filter(r => r.status === 'error')

  const display =
    tab === 'detected' ? detected :
    tab === 'clean' ? clean :
    tab === 'errors' ? errors :
    results

  return (
    <div className="gallery-panel">
      <div className="gallery-tabs">
        <button className={`tab${tab === 'detected' ? ' active' : ''}`} onClick={() => setTab('detected')}>
          Detected ({detected.length})
        </button>
        <button className={`tab${tab === 'clean' ? ' active' : ''}`} onClick={() => setTab('clean')}>
          Clean ({clean.length})
        </button>
        <button className={`tab${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>
          All ({results.length})
        </button>
        {errors.length > 0 && (
          <button className={`tab${tab === 'errors' ? ' active' : ''}`} onClick={() => setTab('errors')}>
            Errors ({errors.length})
          </button>
        )}
      </div>

      {display.length === 0 ? (
        <div className="gallery-empty">
          {tab === 'detected' ? 'No weeds detected yet.' : 'No photos in this category.'}
        </div>
      ) : (
        <div className="gallery-grid">
          {display.map(photo => (
            <div
              key={photo.path}
              className={`gallery-item${photo.detected ? ' flagged' : ''}${selected?.path === photo.path ? ' selected' : ''}`}
              onClick={() => onSelect(photo)}
            >
              <img
                src={`${apiBase}/api/image?path=${encodeURIComponent(photo.path)}`}
                alt={photo.filename}
                loading="lazy"
              />
              <div className="gallery-label">
                <span className="filename">{photo.filename}</span>
                {photo.detected && (
                  <span className="badge-weed">
                    {(photo.detections?.filter(d => d.is_match).length || 0) || 1} ·{' '}
                    {photo.species || 'weed'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
