// Scanner orchestration. For each file:
//   1. hash → cache lookup
//   2. opencv.js findPurpleBlobs
//   3. for each blob: cropBlobToJpegBlob → analyzeCrop → Detection
//   4. assemble PhotoResult, persist to IndexedDB, yield to caller

import { findPurpleBlobs, cropBlobToJpegBlob, fileToImage } from './prefilter.js'
import { analyzeCrop } from './gemini.js'
import { getCached, hashFile, putResult } from './db.js'

/**
 * Scan a single file. Calls onProgress({ stage, blobIndex, totalBlobs }) at
 * each step so the UI can show fine-grained status. Returns the full
 * PhotoResult (matching the Python schema).
 */
export async function scanFile(file, weeds, { forceRescan = false, onProgress = () => {} } = {}) {
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
      const analysis = await analyzeCrop(jpeg, weeds)
      det.species = analysis.species ?? null
      det.confidence = analysis.confidence ?? 'low'
      det.description = analysis.description ?? null
      det.is_match = !!analysis.is_plant
    } catch (e) {
      det.description = `analyzer error: ${(e.message || e).toString().slice(0, 200)}`
    }
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
