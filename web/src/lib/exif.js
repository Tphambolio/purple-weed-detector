// Extract the most-authoritative available capture date from a File.
//
// Priority:
//   1. EXIF DateTimeOriginal (camera/drone shutter time — best source)
//   2. EXIF CreateDate (often equal to DateTimeOriginal; DJI writes both)
//   3. File.lastModified (filesystem mtime — may have been re-saved)
//   4. Current date (final fallback)
//
// `exifr` is tree-shakable and ~10 KB for just the tag parser we need.

import exifr from 'exifr'

/** Extract the best-available photo date from a single File. */
export async function extractPhotoDate(file) {
  if (!file) return { date: new Date(), source: 'now' }

  try {
    // Only parse the three tags we care about — much faster than full EXIF.
    const tags = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate'])
    if (tags?.DateTimeOriginal instanceof Date && !isNaN(tags.DateTimeOriginal)) {
      return { date: tags.DateTimeOriginal, source: 'exif' }
    }
    if (tags?.CreateDate instanceof Date && !isNaN(tags.CreateDate)) {
      return { date: tags.CreateDate, source: 'exif' }
    }
  } catch {
    // Screenshots, re-encoded images, and non-JPEG files often throw. Fall through.
  }

  if (file.lastModified) {
    return { date: new Date(file.lastModified), source: 'mtime' }
  }
  return { date: new Date(), source: 'now' }
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
