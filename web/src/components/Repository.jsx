import { useEffect, useState } from 'react'
import { getAllAnnotations, deleteAnnotation } from '../lib/db'
import { WEED_SPECIES } from './AnnotationCanvas'

const SPECIES_LABEL = Object.fromEntries(WEED_SPECIES.map(s => [s.value, s.label]))

export default function Repository() {
  const [annotations, setAnnotations] = useState([])
  const [filter, setFilter]           = useState('all')

  useEffect(() => { getAllAnnotations().then(setAnnotations) }, [])

  const handleDelete = async (id) => {
    await deleteAnnotation(id)
    setAnnotations(prev => prev.filter(a => a.id !== id))
  }

  const exportJSON = () => {
    const rows = annotations.map(({ id, filename, imageHash, species, rect, created_at }) =>
      ({ id, filename, imageHash, species, rect, created_at }))
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `weed-annotations-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportCrops = () => {
    filtered.forEach((a, i) => {
      // Stagger clicks so browser doesn't block them
      setTimeout(() => {
        const link      = document.createElement('a')
        link.href       = a.crop
        link.download   = `${a.species}_${a.id}_${a.filename.replace(/\.[^.]+$/, '')}.jpg`
        link.click()
      }, i * 80)
    })
  }

  const presentSpecies = [...new Set(annotations.map(a => a.species))]
  const filtered       = filter === 'all'
    ? annotations
    : annotations.filter(a => a.species === filter)

  const uniqueImages = new Set(annotations.map(a => a.imageHash)).size

  return (
    <div className="repository-panel">
      <div className="repository-header">
        <div>
          <h2>Confirmed ID Repository</h2>
          <p className="repository-subtitle">
            {annotations.length} annotation{annotations.length !== 1 ? 's' : ''} across {uniqueImages} image{uniqueImages !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="repository-actions">
          <button className="btn-secondary" onClick={exportJSON}   disabled={!annotations.length}>Export JSON</button>
          <button className="btn-secondary" onClick={exportCrops}  disabled={!filtered.length}>Export Crops</button>
        </div>
      </div>

      <div className="gallery-tabs">
        <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All ({annotations.length})
        </button>
        {presentSpecies.map(s => (
          <button
            key={s}
            className={`tab ${filter === s ? 'active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {SPECIES_LABEL[s] || s} ({annotations.filter(a => a.species === s).length})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="gallery-empty">
          {annotations.length === 0
            ? 'No confirmed IDs yet. Open a photo and click "+ Annotate weed".'
            : 'No IDs for this species.'}
        </div>
      ) : (
        <div className="repo-grid">
          {filtered.map(a => (
            <div key={a.id} className="repo-item">
              {a.crop
                ? <img src={a.crop} alt={SPECIES_LABEL[a.species] || a.species} />
                : <div className="repo-no-crop">No crop</div>
              }
              <div className="repo-item-info">
                <span className="repo-species">{SPECIES_LABEL[a.species] || a.species}</span>
                <span className="repo-filename" title={a.filename}>{a.filename}</span>
                <span className="repo-date">{new Date(a.created_at).toLocaleDateString()}</span>
              </div>
              <button className="repo-delete" onClick={() => handleDelete(a.id)} title="Delete">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
