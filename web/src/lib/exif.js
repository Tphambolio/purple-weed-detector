// Extract date and GPS metadata from a drone photo File.
//
// Priority for date:
//   1. EXIF DateTimeOriginal (camera/drone shutter time — best source)
//   2. EXIF CreateDate (often equal to DateTimeOriginal; DJI writes both)
//   3. File.lastModified (filesystem mtime — may have been re-saved)
//   4. Current date (final fallback)
//
// GPS comes from EXIF GPSLatitude / GPSLongitude / GPSAltitude — DJI drones
// write all three by default. exifr handles the GPS reference (N/S, E/W) and
// returns signed decimal degrees, so we can use them directly with Leaflet.
//
// `exifr` is tree-shakable and ~10 KB for just the tag parser we need.

import exifr from 'exifr'

const PHOTO_TAGS = [
  'DateTimeOriginal', 'CreateDate',
  'GPSLatitude', 'GPSLongitude', 'GPSAltitude',
  'GPSLatitudeRef', 'GPSLongitudeRef', 'GPSAltitudeRef',
  'Make', 'Model',
]

/**
 * Extract the best-available photo date AND GPS coordinates from a single File.
 * Returns { date, source, location?: { lat, lng, altitude?, source: 'exif' } }.
 */
export async function extractPhotoMeta(file) {
  if (!file) return { date: new Date(), source: 'now', location: null }

  let tags = null
  try {
    // Pull date + GPS in one parse pass — exifr handles GPS reference signing.
    tags = await exifr.parse(file, PHOTO_TAGS)
  } catch {
    // Screenshots, re-encoded images, and non-JPEG files often throw. Fall through.
  }

  // ── Date ─────────────────────────────────────────────────────────
  let date = null
  let source = 'now'
  if (tags?.DateTimeOriginal instanceof Date && !isNaN(tags.DateTimeOriginal)) {
    date = tags.DateTimeOriginal
    source = 'exif'
  } else if (tags?.CreateDate instanceof Date && !isNaN(tags.CreateDate)) {
    date = tags.CreateDate
    source = 'exif'
  } else if (file.lastModified) {
    date = new Date(file.lastModified)
    source = 'mtime'
  } else {
    date = new Date()
    source = 'now'
  }

  // ── GPS ──────────────────────────────────────────────────────────
  let location = null
  if (tags && typeof tags.GPSLatitude === 'number' && typeof tags.GPSLongitude === 'number') {
    // exifr already signs GPSLatitude/Longitude using the Ref tags.
    const lat = tags.GPSLatitude
    const lng = tags.GPSLongitude
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      location = {
        lat,
        lng,
        altitude: typeof tags.GPSAltitude === 'number' ? tags.GPSAltitude : null,
        source: 'exif',
      }
    }
  }

  return { date, source, location, camera: tags?.Make || null, model: tags?.Model || null }
}

/**
 * Backwards-compat wrapper. Returns just the date+source like the old API.
 * Existing call sites (App.jsx EXIF auto-fill) continue to work unchanged.
 */
export async function extractPhotoDate(file) {
  const { date, source } = await extractPhotoMeta(file)
  return { date, source }
}

/**
 * Given a list of Files, return a single representative date.
 *
 * Prefers EXIF-sourced dates when available (even if older than mtime-sourced
 * dates), since EXIF is always shutter time while mtime can be anything
 * (re-save, download, etc.). Within the preferred pool, returns the earliest
 * — this matches the "when was the survey flown" semantic for a batch upload.
 */
export async function earliestPhotoDate(files) {
  if (!files || files.length === 0) return { date: new Date(), source: 'now' }

  const dates = await Promise.all(Array.from(files).map(extractPhotoDate))
  const exifDates = dates.filter(d => d.source === 'exif')
  const pool = exifDates.length > 0 ? exifDates : dates
  return pool.reduce((a, b) => (a.date < b.date ? a : b))
}

/** Human-friendly label for the source of a photo date. */
export function formatDateSource(source) {
  switch (source) {
    case 'exif':  return 'from EXIF'
    case 'mtime': return 'from file timestamp'
    case 'now':   return 'no date found — using today'
    default:      return source
  }
}
