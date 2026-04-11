// IndexedDB cache via Dexie. Replaces backend/database.py.
// Keyed by content hash so the same photo isn't re-analyzed across uploads.
//
// Schema v1 — single `results` table.
// Schema v2 — added `verdicts` table for human-in-the-loop corrections + learning.

import Dexie from 'dexie'

export const db = new Dexie('purple_weed_detector')

db.version(1).stores({
  results: 'hash, filename, scanned_at',
})

db.version(2).stores({
  // results: schema unchanged from v1, just re-declared so the version bump is recognised
  results: 'hash, filename, scanned_at',
  // verdicts: each row is one human-in-the-loop correction
  //   ++id            auto primary key
  //   photo_hash      FK to results.hash (which photo this verdict came from)
  //   phash           16-hex dHash of the cropped blob (for inheritance lookups)
  //   created_at      ISO timestamp (for ordering / few-shot picking)
  //   [photo_hash+blob_index]  composite — fast lookup of "verdict for this exact blob"
  verdicts: '++id, photo_hash, phash, created_at, [photo_hash+blob_index]',
})


// ───────────────────────── results ─────────────────────────

export async function hashFile(file) {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function getCached(hash) {
  return await db.results.get(hash)
}

export async function putResult(result) {
  // previewUrl is a transient blob: URL — don't persist it across sessions.
  const { previewUrl, fromCache, ...persistable } = result
  await db.results.put({
    ...persistable,
    scanned_at: new Date().toISOString(),
  })
}

export async function clearCache() {
  await db.results.clear()
}


// ───────────────────────── verdicts ─────────────────────────

/**
 * Persist a human verdict. Caller fills in the full row shape:
 *   { photo_hash, blob_index, ai_verdict, human_verdict, human_species,
 *     phash, thumb_b64, blob_geom }
 *
 * Replaces any prior verdict for the same (photo_hash, blob_index) pair.
 */
export async function recordVerdict(verdict) {
  const existing = await db.verdicts
    .where('[photo_hash+blob_index]')
    .equals([verdict.photo_hash, verdict.blob_index])
    .first()

  const row = {
    ...verdict,
    created_at: new Date().toISOString(),
  }

  if (existing) {
    await db.verdicts.update(existing.id, row)
    return existing.id
  } else {
    return await db.verdicts.add(row)
  }
}

export async function removeVerdict(photoHash, blobIndex) {
  await db.verdicts
    .where('[photo_hash+blob_index]')
    .equals([photoHash, blobIndex])
    .delete()
}

export async function getVerdictsForPhoto(photoHash) {
  return await db.verdicts.where('photo_hash').equals(photoHash).toArray()
}

export async function clearVerdicts() {
  await db.verdicts.clear()
}

/**
 * Find the verdict whose pHash is closest to `phash`, but only if the
 * Hamming distance is at most `maxDistance`. Returns the verdict row + the
 * distance, or null if nothing close enough exists.
 *
 * Linear scan — fine under ~1000 verdicts. Bucket-by-prefix later if needed.
 */
export async function findNearestVerdictByPhash(phash, maxDistance = 6) {
  const all = await db.verdicts.toArray()
  let best = null
  let bestDist = Infinity
  for (const v of all) {
    if (!v.phash) continue
    const d = hammingHex(phash, v.phash)
    if (d < bestDist) {
      bestDist = d
      best = v
    }
  }
  if (best && bestDist <= maxDistance) {
    return { verdict: best, distance: bestDist }
  }
  return null
}

/**
 * Pick a balanced set of recent verdicts to use as few-shot examples in
 * the Gemini prompt. Returns up to `k` thumbnails — half positive
 * (confirmed weed of the active species set) and half negative
 * (confirmed not-a-plant or wrong-species-to-non-target).
 */
export async function pickFewShotExamples({ weeds, k = 4 } = {}) {
  const isAny = !weeds || weeds.includes('any')
  const all = await db.verdicts
    .orderBy('created_at')
    .reverse()
    .toArray()

  const positives = []
  const negatives = []

  for (const v of all) {
    if (!v.thumb_b64) continue
    const isPositive = v.human_verdict === 'correct'
      || (v.human_verdict === 'wrong_species'
          && v.human_species
          && v.human_species !== 'not_a_plant'
          && (isAny || weeds.includes(v.human_species)))
    if (isPositive) {
      if (positives.length < k / 2) positives.push(positiveLabel(v))
    } else {
      if (negatives.length < k / 2) negatives.push(negativeLabel(v))
    }
    if (positives.length >= k / 2 && negatives.length >= k / 2) break
  }

  return [...positives, ...negatives]
}

function positiveLabel(v) {
  const species = v.human_species || v.ai_verdict?.species || 'a target weed'
  return {
    thumb_b64: v.thumb_b64,
    label: `THIS IS ${species}`,
  }
}

function negativeLabel(v) {
  const desc = v.ai_verdict?.description || 'not a target weed'
  return {
    thumb_b64: v.thumb_b64,
    label: `THIS IS NOT a target weed (${desc.slice(0, 60)})`,
  }
}


// ───────────────────────── helpers ─────────────────────────

/** Hamming distance between two hex strings of equal length. */
export function hammingHex(a, b) {
  if (a.length !== b.length) return Infinity
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}
