import { useState } from 'react'
import { COLOR_CLASSES } from '../lib/colorClasses.js'

export default function PhotoGallery({ results, selected, onSelect }) {
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
          {display.map(photo => {
            const matchCount = (photo.detections || []).filter(d => d.is_match).length
            return (
              <div
                key={photo.hash}
                className={`gallery-item${photo.detected ? ' flagged' : ''}${selected?.hash === photo.hash ? ' selected' : ''}`}
                onClick={() => onSelect(photo)}
              >
                <img src={photo.previewUrl} alt={photo.filename} loading="lazy" />
                {photo.class_counts && Object.keys(photo.class_counts).length > 0 && (
                  <div className="gallery-class-strip">
                    {Object.entries(photo.class_counts).map(([clsId, count]) => {
                      const cls = COLOR_CLASSES[clsId]
                      if (!cls) return null
                      return (
                        <span
                          key={clsId}
                          className="gallery-class-dot"
                          title={`${count} ${cls.label}`}
                          style={{ backgroundColor: cls.bbox_color }}
                        >
                          <span className="gallery-class-count">{count}</span>
                        </span>
                      )
                    })}
                  </div>
                )}
                <div className="gallery-label">
                  <span className="filename">{photo.filename}</span>
                  {photo.detected && (
                    <span className="badge-weed">
                      {matchCount || 1} · {photo.species || 'weed'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
