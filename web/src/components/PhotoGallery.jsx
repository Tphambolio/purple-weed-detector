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

  const tabClass = (id) => `px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${
    tab === id
      ? 'bg-primary/15 text-primary'
      : 'text-on-surface-variant/60 hover:text-on-surface-variant'
  }`

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <button className={tabClass('detected')} onClick={() => setTab('detected')}>
          Detected · {detected.length}
        </button>
        <button className={tabClass('clean')} onClick={() => setTab('clean')}>
          Clean · {clean.length}
        </button>
        <button className={tabClass('all')} onClick={() => setTab('all')}>
          All · {results.length}
        </button>
        {errors.length > 0 && (
          <button className={tabClass('errors')} onClick={() => setTab('errors')}>
            Errors · {errors.length}
          </button>
        )}
      </div>

      {display.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-surface-container-low/50 text-on-surface-variant/60 text-sm">
          {tab === 'detected' ? 'No weeds detected yet.' : 'No photos in this category.'}
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {display.map(photo => {
            const matchCount = (photo.detections || []).filter(d => d.is_match).length
            const isSelected = selected?.hash === photo.hash
            return (
              <button
                key={photo.hash}
                onClick={() => onSelect(photo)}
                className={`group relative aspect-square rounded-xl overflow-hidden bg-surface-container-low text-left transition-all ${
                  isSelected
                    ? 'ring-2 ring-primary'
                    : 'hover:ring-1 hover:ring-primary/40'
                }`}
              >
                <img
                  src={photo.previewUrl}
                  alt={photo.filename}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {/* Top gradient overlay for class chip readability */}
                <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
                {/* Bottom gradient for filename + badge */}
                <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black/85 to-transparent pointer-events-none" />

                {/* Per-class blob counts (top right) */}
                {photo.class_counts && Object.keys(photo.class_counts).length > 0 && (
                  <div className="absolute top-2 right-2 flex flex-wrap gap-1 max-w-[60%] justify-end z-10">
                    {Object.entries(photo.class_counts).map(([clsId, count]) => {
                      const cls = COLOR_CLASSES[clsId]
                      if (!cls) return null
                      return (
                        <span
                          key={clsId}
                          title={`${count} ${cls.label}`}
                          className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[10px] font-black text-black/85 shadow-md"
                          style={{ backgroundColor: cls.bbox_color }}
                        >
                          {count}
                        </span>
                      )
                    })}
                  </div>
                )}

                {/* Detected badge (top left) */}
                {photo.detected && (
                  <div className="absolute top-2 left-2 z-10">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-container/70 backdrop-blur-sm text-tertiary text-[10px] font-black uppercase tracking-wider">
                      <span className="w-1 h-1 rounded-full bg-tertiary" />
                      {matchCount}
                    </span>
                  </div>
                )}

                {/* Filename (bottom) */}
                <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
                  <div className="text-xs text-white font-semibold truncate">{photo.filename}</div>
                  {photo.detected && photo.species && (
                    <div className="text-[10px] text-white/70 truncate mt-0.5">{photo.species}</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
