export default function PhotoDetail({ photo, onClose, apiBase }) {
  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="detail-content">
          <div className="detail-image">
            <img
              src={`${apiBase}/api/image?path=${encodeURIComponent(photo.path)}`}
              alt={photo.filename}
            />
          </div>

          <div className="detail-info">
            <h2>{photo.filename}</h2>
            <p className="detail-path">{photo.path}</p>

            <div className={`detection-badge ${photo.detected ? 'positive' : 'negative'}`}>
              {photo.detected ? 'Weed Detected' : 'Clean'}
            </div>

            {photo.detected && (
              <dl className="detail-meta">
                {photo.species && <>
                  <dt>Species</dt>
                  <dd>{photo.species}</dd>
                </>}
                {photo.confidence && <>
                  <dt>Confidence</dt>
                  <dd className={`confidence-${photo.confidence}`}>{photo.confidence}</dd>
                </>}
                {photo.location && <>
                  <dt>Location</dt>
                  <dd>{photo.location}</dd>
                </>}
                {photo.description && <>
                  <dt>Description</dt>
                  <dd>{photo.description}</dd>
                </>}
              </dl>
            )}

            {!photo.detected && photo.description && (
              <p className="detail-note">{photo.description}</p>
            )}

            <div className="detail-status">
              <span>Status: {photo.status}</span>
              <span>Pre-filter: {photo.has_purple ? 'purple pixels found' : 'no purple pixels'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
