// Frontend wrapper around the weed-records Cloud Function.
//
// The function URL is injected at build time via VITE_RECORDS_URL (see
// gcp/deploy.sh). When unset (e.g. local dev), submit/list become no-ops
// so the rest of the app keeps working without a backend.

const RECORDS_URL = import.meta.env.VITE_RECORDS_URL || ''

/** Is the records backend configured for this build? */
export function recordsEnabled() {
  return !!RECORDS_URL
}

/**
 * Submit one or many detection records. The backend is idempotent — re-submitting
 * the same {photo_hash, blob_index} overwrites the existing record. Safe to call
 * multiple times for the same blob (e.g. once on auto-detect, again on verdict).
 */
export async function submitDetections(records) {
  if (!RECORDS_URL) return { submitted: 0, ids: [], errors: [], skipped: true }
  if (!Array.isArray(records)) records = [records]
  if (records.length === 0) return { submitted: 0, ids: [], errors: [] }

  const res = await fetch(`${RECORDS_URL}?op=submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(records),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`records submit ${res.status}: ${txt.slice(0, 200)}`)
  }
  return await res.json()
}

/** List records, optionally filtered by species. */
export async function listDetections({ species = null, limit = 500, includeThumbs = false } = {}) {
  if (!RECORDS_URL) return { count: 0, records: [], skipped: true }
  const params = new URLSearchParams({ op: 'list', limit: String(limit) })
  if (species) params.set('species', species)
  if (includeThumbs) params.set('thumbs', '1')
  const res = await fetch(`${RECORDS_URL}?${params}`)
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`records list ${res.status}: ${txt.slice(0, 200)}`)
  }
  return await res.json()
}

/**
 * Build the wire-format record from a (photo, detection, blobIndex) triple.
 * Pulls everything the backend needs from local state — no network call.
 */
export function detectionToRecord(photo, det, blobIndex) {
  return {
    photo_hash: photo.hash,
    blob_index: blobIndex,
    species_id: det.species_id || det.species || 'unknown',
    species_label: det.species || det.species_id || 'unknown',
    color_class: det.color_class || null,
    confidence: det.confidence || 'low',
    is_match: !!det.is_match,
    human_verdict: det.human_verdict || null,
    human_species: det.human_species || null,
    description: det.description || '',
    photo_filename: photo.filename || '',
    photo_date: photo.photo_date || null,
    photo_camera: photo.photo_camera || null,
    location: photo.photo_location || null,
    bbox: {
      x: det.x, y: det.y, w: det.w, h: det.h,
      cx: det.cx, cy: det.cy, area_px: det.area_px,
    },
    thumb_b64: det.thumb_b64 || null,
  }
}

/**
 * Push every confirmed-positive detection from a PhotoResult to the backend.
 * Skips photos with no GPS (can't put them on the map). Returns a summary.
 */
export async function publishConfirmedDetections(photo) {
  if (!recordsEnabled()) return { published: 0, skipped: 'records-disabled' }
  if (!photo?.detections || photo.detections.length === 0) return { published: 0, skipped: 'no-detections' }
  if (!photo.photo_location) return { published: 0, skipped: 'no-gps' }

  const records = photo.detections
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.is_match)
    .map(({ d, i }) => detectionToRecord(photo, d, i))

  if (records.length === 0) return { published: 0, skipped: 'no-matches' }

  try {
    const result = await submitDetections(records)
    return { published: result.submitted || records.length }
  } catch (e) {
    console.error('publishConfirmedDetections failed', e)
    return { published: 0, error: e.message }
  }
}
