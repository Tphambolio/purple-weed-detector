// Scanner orchestration. For each file:
//   1. hash → cache lookup
//   2. opencv.js findPurpleBlobs
//   3. for each blob: cropBlobToJpegBlob → analyzeCrop → Detection
//   4. assemble PhotoResult, persist to IndexedDB, yield to caller

import { findPurpleBlobs, cropBlobToJpegBlob, fileToImage } from './prefilter.js'
import { analyzeCrop } from './gemini.js'
import {
  getCached, hashFile, putResult,
  findNearestVerdictByPhash, pickFewShotExamples,
} from './db.js'
import { computeDhash, blobToThumbnailB64 } from './phash.js'


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
  return {
    ...photo,
    detected: matches.length > 0,
    species: firstMatch?.species ?? null,
    confidence: firstMatch?.confidence ?? null,
    description: firstMatch?.description
      ?? (detections.length > 0
        ? `${detections.length} purple blob(s); none confirmed as target weed`
        : photo.description),
  }
}


// ───────────────────────── scan pipeline ─────────────────────────

/**
 * Scan a single file. Calls onProgress({ stage, blobIndex, totalBlobs }) at
 * each step so the UI can show fine-grained status. Returns the full
 * PhotoResult (matching the Python schema).
 */
export async function scanFile(file, weeds, {
  forceRescan = false,
  onProgress = () => {},
  fewShot = false,
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

  onProgress({ stage: 'prefilter' })
  // Worker decodes the file via createImageBitmap and runs CV off-thread.
  const { width, height, blobs } = await findPurpleBlobs(file)

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
        // 3B: include few-shot examples (if enabled and any exist).
        const analysis = await analyzeCrop(jpeg, weeds, { examples })
        det.species = analysis.species ?? null
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
      ?? `${detections.length} purple blob(s); none confirmed as target weed`,
    detections,
    previewUrl,
  }
  await putResult(result)
  return result
}
