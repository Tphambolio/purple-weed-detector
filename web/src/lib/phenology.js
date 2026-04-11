// Pure date math for species bloom windows.
//
// Bloom ranges in species.js are stored as { start: 'MM-DD', end: 'MM-DD' }
// so they're year-agnostic. All Edmonton bloom windows fall inside April–October
// with no year wraparound, which keeps this math very simple.

/** Convert a Date to 'MM-DD' for year-agnostic comparison. */
export function toMonthDay(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${m}-${d}`
}

/** Inclusive MM-DD range test. */
export function inRange(monthDay, start, end) {
  return monthDay >= start && monthDay <= end
}

/** True if `species` is in flower / identifiable on `date`. */
export function isSpeciesActive(species, date = new Date()) {
  const md = toMonthDay(date)
  return (species.bloom || []).some(r => inRange(md, r.start, r.end))
}

/** Filter a species list to those active on the given date. */
export function getActiveSpecies(date, allSpecies) {
  return (allSpecies || []).filter(sp => isSpeciesActive(sp, date))
}

/**
 * Return 0–1 progress through the current bloom window, or null if not in
 * bloom. Uses MM-DD ordinal (month*31 + day) for a decent approximation
 * without pulling in a date library.
 */
export function getBloomProgress(species, date = new Date()) {
  const md = toMonthDay(date)
  for (const r of species.bloom || []) {
    if (inRange(md, r.start, r.end)) {
      const ord = (mmdd) => {
        const [m, d] = mmdd.split('-').map(Number)
        return m * 31 + d
      }
      const s = ord(r.start), e = ord(r.end), c = ord(md)
      if (e <= s) return 0
      return Math.min(1, Math.max(0, (c - s) / (e - s)))
    }
  }
  return null
}

/**
 * Return a short human-readable bloom status for a species on a given date.
 * Used in species pickers so users can see at a glance whether a species is
 * worth scanning for.
 */
export function getBloomStatus(species, date = new Date()) {
  if (isSpeciesActive(species, date)) {
    const progress = getBloomProgress(species, date)
    if (progress === null) return 'in season'
    if (progress < 0.25) return 'early bloom'
    if (progress > 0.75) return 'late bloom'
    return 'peak bloom'
  }
  // Find the next upcoming bloom window in the same calendar year.
  const md = toMonthDay(date)
  const upcoming = (species.bloom || [])
    .filter(r => r.start > md)
    .sort((a, b) => a.start.localeCompare(b.start))[0]
  if (upcoming) return `blooms ${upcoming.start}`
  return 'out of season'
}
