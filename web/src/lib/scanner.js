// Scanner orchestration. For each file:
//   1. hash → cache lookup
//   2. opencv.js findColoredBlobs across the colour classes spanned by the
//      currently selected target species
//   3. for each blob: cropBlobToJpegBlob → analyzeCrop → Detection
//   4. assemble PhotoResult, persist to IndexedDB, yield to caller

import { findColoredBlobs, cropBlobToJpegBlob, fileToImage } from './prefilter.js'
import { analyzeCrop } from './gemini.js'
import {
  getCached, hashFile, putResult,
  findNearestVerdictByPhash, pickFewShotExamples,
} from './db.js'
import { computeDhash, blobToThumbnailB64 } from './phash.js'
import { SPECIES, getSpeciesById } from './species.js'
import { COLOR_CLASSES } from './colorClasses.js'
import { extractPhotoMeta } from './exif.js'


// ───────────────────────── HITL verdict helpers (pure) ─────────────────────────

/**
 * Snapshot the AI fields of a detection so a future "Clear verdict" can
 * restore them. Mutates and returns `det`. Idempotent — only writes the
 * snapshot if it doesn't already exist.
 */
export function ensureAiSnapshot(det) {
  if (det.ai_snapshot) return det
  det.ai_snapshot = {
    species: det.species ?? null,
    confidence: det.confidence ?? null,
    description: det.description ?? null,
    is_match: !!det.is_match,
  }
  return det
}

/**
 * Apply a human verdict to a detection. Pure function: takes a detection
 * object + a verdict descriptor, returns a NEW detection object reflecting
 * the human's correction.
 *
 * verdict: {
 *   human_verdict: 'correct' | 'wrong_species' | 'not_a_plant',
 *   human_species: <target weed key> | null,    // only used when 'wrong_species'
 *   targetWeeds: ['any'|'purple_loosestrife'|...]  // currently selected target list
 * }
 */
export function applyVerdictToDetection(det, verdict) {
  const next = ensureAiSnapshot({ ...det })
  next.human_verdict = verdict.human_verdict
  next.human_species = verdict.human_species ?? null
  next.human_verdict_at = new Date().toISOString()

  const isAny = !verdict.targetWeeds || verdict.targetWeeds.includes('any')

  if (verdict.human_verdict === 'correct') {
    next.is_match = true
    // species stays as the AI's guess
  } else if (verdict.human_verdict === 'wrong_species') {
    if (verdict.human_species && verdict.human_species !== 'not_a_plant') {
      next.is_match = isAny || verdict.targetWeeds.includes(verdict.human_species)
      next.species = verdict.human_species
      next.confidence = 'high' // human-verified
    } else {
      next.is_match = false
    }
  } else if (verdict.human_verdict === 'not_a_plant') {
    next.is_match = false
  }

  return next
}

/**
 * Restore a detection from its ai_snapshot, dropping any human verdict.
 * Returns a new object. If no snapshot exists, returns the input unchanged.
 */
export function clearVerdictFromDetection(det) {
  if (!det.ai_snapshot) {
    const { human_verdict, human_species, human_verdict_at, ...rest } = det
    return rest
  }
  const next = { ...det, ...det.ai_snapshot }
  delete next.human_verdict
  delete next.human_species
  delete next.human_verdict_at
  return next
}

/**
 * Recompute a PhotoResult's top-level summary fields from its current
 * detections. Use after applyVerdictToDetection to keep the gallery
 * count badges in sync. Returns a new PhotoResult.
 */
export function recomputePhotoSummary(photo) {
  const detections = photo.detections || []
  const matches = detections.filter(d => d.is_match)
  const firstMatch = matches[0] || null
  // Refresh per-class counts in case verdicts shifted what counts as a match.
  const class_counts = {}
  for (const d of detections) {
    if (!d.color_class) continue
    class_counts[d.color_class] = (class_counts[d.color_class] || 0) + 1
  }
  return {
    ...photo,
    detected: matches.length > 0,
    species: firstMatch?.species ?? null,
    confidence: firstMatch?.confidence ?? null,
    class_counts,
    description: firstMatch?.description
      ?? (detections.length > 0
        ? `${detections.length} candidate blob(s) across ${Object.keys(class_counts).length} colour class(es); none confirmed`
        : photo.description),
  }
}


// ───────────────────────── scan pipeline ─────────────────────────

/**
 * Resolve a `weeds` selection (legacy strings or species ids) into a list of
 * actual species objects from the registry.
 *
 * Accepted shapes:
 *   ['any']                              → all 18 registry species
 *   ['purple_loosestrife', 'thistle']    → legacy alias map (back-compat)
 *   ['canada_thistle', 'leafy_spurge']   → modern species ids
 */
function resolveTargetSpecies(weeds) {
  if (!Array.isArray(weeds) || weeds.length === 0 || weeds.includes('any')) {
    return SPECIES
  }
  // Legacy alias map for the original 4-option picker — keeps existing
  // sessions / cached results from breaking when this code lands.
  const LEGACY = {
    purple_loosestrife: 'purple_loosestrife',
    thistle: 'canada_thistle',
    dames_rocket: 'dames_rocket',
  }
  const ids = new Set(weeds.map(w => LEGACY[w] || w))
  const resolved = SPECIES.filter(s => ids.has(s.id))
  // Defensive fallback: if the caller passed something we don't recognize,
  // scan everything rather than scanning nothing.
  return resolved.length > 0 ? resolved : SPECIES
}

/**
 * Build the array of colour-class definitions to send to the worker, given
 * a list of target species. Dedupes by class id and injects the id into
 * each class object so the worker can tag blobs.
 */
function buildClassPayload(targetSpecies) {
  const seen = new Set()
  const out = []
  for (const sp of targetSpecies) {
    if (!sp.color_class || seen.has(sp.color_class)) continue
    const def = COLOR_CLASSES[sp.color_class]
    if (!def) continue
    seen.add(sp.color_class)
    out.push({ id: sp.color_class, ...def })
  }
  return out
}

/**
 * Scan a single file. Calls onProgress({ stage, blobIndex, totalBlobs }) at
 * each step so the UI can show fine-grained status. Returns the full
 * PhotoResult (matching the Python schema).
 */
export async function scanFile(file, weeds, {
  forceRescan = false,
  onProgress = () => {},
  fewShot = false,
  photoDate = null,
} = {}) {
  onProgress({ stage: 'hashing' })
  const hash = await hashFile(file)

  if (!forceRescan) {
    const cached = await getCached(hash)
    if (cached) {
      onProgress({ stage: 'cached' })
      // previewUrl is per-session — re-create from the uploaded file.
      return { ...cached, previewUrl: URL.createObjectURL(file), fromCache: true }
    }
  }

  // Pull EXIF metadata (date already passed in via opts; we need photo_location
  // for the records backend / map view).
  let photoMeta = null
  try { photoMeta = await extractPhotoMeta(file) } catch {}
  const photoLocation = photoMeta?.location || null
  const photoCamera = photoMeta?.model || photoMeta?.camera || null

  // Derive colour classes from the selected species. The resulting array
  // drives both the CV worker masks AND the Gemini prompt context — Phase 3
  // adds species-aware prompts.
  const targetSpecies = resolveTargetSpecies(weeds)
  const classPayload = buildClassPayload(targetSpecies)

  onProgress({ stage: 'prefilter' })
  // Worker decodes the file via createImageBitmap and runs CV off-thread.
  const { width, height, blobs } = await findColoredBlobs(file, classPayload)

  // Decode an HTMLImageElement on the main thread for the per-blob crop step.
  onProgress({ stage: 'decoding' })
  const image = await fileToImage(file)

  // Build a transient object URL for the gallery to render the original.
  const previewUrl = URL.createObjectURL(file)

  // Few-shot examples: pull once per scan, reuse for every blob.
  let examples = []
  if (fewShot && blobs.length > 0) {
    try { examples = await pickFewShotExamples({ weeds, k: 4 }) } catch {}
  }

  if (blobs.length === 0) {
    const result = {
      hash,
      filename: file.name,
      width, height,
      has_purple: false,
      detected: false,
      status: 'skipped',
      species: null,
      confidence: null,
      description: null,
      detections: [],
      previewUrl,
      photo_date: photoDate ? new Date(photoDate).toISOString() : null,
      photo_location: photoLocation,
      photo_camera: photoCamera,
      target_species: targetSpecies.map(s => s.id),
    }
    await putResult(result)
    return result
  }

  const detections = []
  let firstMatch = null
  for (let i = 0; i < blobs.length; i++) {
    onProgress({ stage: 'analyzing', blobIndex: i, totalBlobs: blobs.length })
    const blob = blobs[i]
    const det = {
      x: blob.x, y: blob.y, w: blob.w, h: blob.h,
      cx: blob.cx, cy: blob.cy, area_px: blob.area,
      color_class: blob.color_class || null,
      species: null, confidence: 'low', description: null, is_match: false,
    }
    try {
      const jpeg = await cropBlobToJpegBlob(image, blob)

      // Compute pHash + thumbnail at scan time so the verdict handler can
      // persist them later without needing to re-crop the original image.
      let phash = null
      try { phash = await computeDhash(jpeg) } catch {}
      det.phash = phash
      try { det.thumb_b64 = await blobToThumbnailB64(jpeg, 128, 0.7) } catch {}

      let inherited = null
      if (phash) {
        try { inherited = await findNearestVerdictByPhash(phash, 6) } catch {}
      }

      if (inherited) {
        // 3A: skip Gemini entirely. Synthesize the detection from the
        // inherited human verdict.
        const v = inherited.verdict
        det.species = v.human_species || v.ai_verdict?.species || null
        det.confidence = 'high'
        det.description = `Inherited from a verified ${v.human_verdict} blob (Hamming ${inherited.distance})`
        if (v.human_verdict === 'correct') {
          det.is_match = true
        } else if (v.human_verdict === 'wrong_species') {
          det.is_match = !!(det.species && det.species !== 'not_a_plant')
        } else {
          det.is_match = false
        }
        det.inherited_from_verdict_id = v.id
      } else {
        const analysis = await analyzeCrop(jpeg, weeds, {
          examples,
          targetSpecies,
          photoDate,
          colorClass: blob.color_class,
        })
        det.species = analysis.species ?? null
        det.species_id = analysis.species_id ?? null
        det.confidence = analysis.confidence ?? 'low'
        det.description = analysis.description ?? null
        det.is_match = !!analysis.is_plant
      }
    } catch (e) {
      det.description = `analyzer error: ${(e.message || e).toString().slice(0, 200)}`
    }
    ensureAiSnapshot(det)
    detections.push(det)
    if (det.is_match && !firstMatch) firstMatch = det
  }

  // Per-class summary so the gallery can show "12 purple · 4 yellow · 0 white"
  const class_counts = {}
  for (const d of detections) {
    if (!d.color_class) continue
    class_counts[d.color_class] = (class_counts[d.color_class] || 0) + 1
  }

  const result = {
    hash,
    filename: file.name,
    width, height,
    has_purple: true,
    detected: firstMatch !== null,
    status: 'analyzed',
    species: firstMatch?.species ?? null,
    confidence: firstMatch?.confidence ?? null,
    description: firstMatch?.description
      ?? `${detections.length} candidate blob(s) across ${Object.keys(class_counts).length} colour class(es); none confirmed as target weed`,
    detections,
    class_counts,
    previewUrl,
    photo_date: photoDate ? new Date(photoDate).toISOString() : null,
    photo_location: photoLocation,
    photo_camera: photoCamera,
    target_species: targetSpecies.map(s => s.id),
  }
  await putResult(result)
  return result
}
