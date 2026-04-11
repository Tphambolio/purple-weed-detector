// Web Worker that runs all opencv.js work off the main thread.
//
// Multi-colour mask pipeline:
//   1. Decode the ImageBitmap, downscale if wider than MAX_CV_WIDTH.
//   2. Compute shared intermediates once (HSV, Lab if needed, ExG mask if any
//      class wants the vegetation gate).
//   3. For each colour class definition the caller passed in, OR together its
//      hsv ranges (and lab ranges if any), AND with the ExG gate if the class
//      requests it, morph-close, run connected components, tag each blob with
//      the class id, and append to the master blob list.
//   4. Sort by area, cap per-class and overall, return native-pixel coords.
//
// Each blob carries `color_class` so the scanner / Gemini prompt builder
// can route it correctly.

importScripts('./opencv.js')

const MIN_AREA_PX_NATIVE_FALLBACK = 30
const MAX_AREA_PX_NATIVE_FALLBACK = 100_000
const MAX_BLOBS_PER_CLASS = 20
const MAX_BLOBS_TOTAL = 60
const MAX_CV_WIDTH = 1500
const CLOSE_KERNEL_SIZE = 9

let cvReady = null

function whenCvReady() {
  if (cvReady) return cvReady
  cvReady = new Promise((resolve) => {
    if (self.cv && self.cv.Mat) return resolve()
    if (self.cv && typeof self.cv.then === 'function') {
      self.cv.then(() => resolve())
      return
    }
    self.Module = self.Module || {}
    self.Module.onRuntimeInitialized = () => resolve()
  })
  return cvReady
}

/**
 * Build a binary mask combining (a) all HSV ranges (OR'd) and (b) all Lab
 * ranges (OR'd), then optionally AND with the ExG vegetation gate.
 *
 * Returns a fresh CV_8U Mat. Caller must delete it.
 */
function buildClassMask(cls, hsv, lab, exgMask) {
  const cv = self.cv
  const rows = hsv.rows
  const cols = hsv.cols
  const classMask = cv.Mat.zeros(rows, cols, cv.CV_8U)

  // HSV sub-ranges
  if (Array.isArray(cls.hsv)) {
    for (const r of cls.hsv) {
      const lo = new cv.Mat(rows, cols, cv.CV_8UC3, [r.h[0], r.s[0], r.v[0], 0])
      const hi = new cv.Mat(rows, cols, cv.CV_8UC3, [r.h[1], r.s[1], r.v[1], 0])
      const sub = new cv.Mat()
      try {
        cv.inRange(hsv, lo, hi, sub)
        cv.bitwise_or(classMask, sub, classMask)
      } finally {
        lo.delete(); hi.delete(); sub.delete()
      }
    }
  }

  // Lab sub-ranges (optional fallback / override for whites)
  if (Array.isArray(cls.lab) && lab) {
    for (const r of cls.lab) {
      const lo = new cv.Mat(rows, cols, cv.CV_8UC3, [r.l[0], r.a[0], r.b[0], 0])
      const hi = new cv.Mat(rows, cols, cv.CV_8UC3, [r.l[1], r.a[1], r.b[1], 0])
      const sub = new cv.Mat()
      try {
        cv.inRange(lab, lo, hi, sub)
        cv.bitwise_or(classMask, sub, classMask)
      } finally {
        lo.delete(); hi.delete(); sub.delete()
      }
    }
  }

  // Vegetation gate: AND with ExG > 0 mask. Suppresses concrete, rooftops,
  // bare soil — anything that isn't actually plant material.
  if (cls.vegetation_gate && exgMask) {
    cv.bitwise_and(classMask, exgMask, classMask)
  }

  return classMask
}

/**
 * Compute the Excess Green (ExG = 2G - R - B) binary vegetation mask.
 * Returns a fresh CV_8U Mat where 255 = "is vegetation". Caller must delete.
 */
function buildExgMask(rgb) {
  const cv = self.cv
  const channels = new cv.MatVector()
  cv.split(rgb, channels)
  const r32 = new cv.Mat()
  const g32 = new cv.Mat()
  const b32 = new cv.Mat()
  const exg = new cv.Mat()
  const exgF = new cv.Mat()
  const mask = new cv.Mat()
  try {
    channels.get(0).convertTo(r32, cv.CV_32F)
    channels.get(1).convertTo(g32, cv.CV_32F)
    channels.get(2).convertTo(b32, cv.CV_32F)
    // 2G - R
    cv.addWeighted(g32, 2, r32, -1, 0, exg)
    // result - B  →  2G - R - B
    cv.addWeighted(exg, 1, b32, -1, 0, exgF)
    // Threshold > 0 means more green than red+blue
    cv.threshold(exgF, exgF, 0, 255, cv.THRESH_BINARY)
    exgF.convertTo(mask, cv.CV_8U)
  } finally {
    channels.delete(); r32.delete(); g32.delete(); b32.delete()
    exg.delete(); exgF.delete()
  }
  return mask
}

function findBlobs(imageBitmap, classes) {
  const cv = self.cv
  if (!Array.isArray(classes) || classes.length === 0) {
    return { width: imageBitmap.width, height: imageBitmap.height, blobs: [] }
  }

  const nativeW = imageBitmap.width
  const nativeH = imageBitmap.height
  const scale = nativeW > MAX_CV_WIDTH ? MAX_CV_WIDTH / nativeW : 1
  const cvW = Math.round(nativeW * scale)
  const cvH = Math.round(nativeH * scale)
  const invScale = 1 / scale

  const off = new OffscreenCanvas(cvW, cvH)
  const ctx = off.getContext('2d')
  ctx.drawImage(imageBitmap, 0, 0, cvW, cvH)
  const imageData = ctx.getImageData(0, 0, cvW, cvH)

  const src = cv.matFromImageData(imageData)
  const rgb = new cv.Mat()
  const hsv = new cv.Mat()
  let lab = null
  let exgMask = null
  const kernel = cv.Mat.ones(CLOSE_KERNEL_SIZE, CLOSE_KERNEL_SIZE, cv.CV_8U)

  // Per-class CV outputs that get re-allocated each iteration
  const classMasks = []

  try {
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)

    const needsLab = classes.some(c => Array.isArray(c.lab) && c.lab.length > 0)
    if (needsLab) {
      lab = new cv.Mat()
      cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab)
    }

    const needsExg = classes.some(c => c.vegetation_gate)
    if (needsExg) {
      exgMask = buildExgMask(rgb)
    }

    const allBlobs = []

    for (const cls of classes) {
      const minPx = cls.min_blob_px ?? MIN_AREA_PX_NATIVE_FALLBACK
      const maxPx = cls.max_blob_px ?? MAX_AREA_PX_NATIVE_FALLBACK
      const minAreaCv = Math.max(2, Math.round(minPx * scale * scale))
      const maxAreaCv = Math.round(maxPx * scale * scale)

      const classMask = buildClassMask(cls, hsv, lab, exgMask)
      classMasks.push(classMask)

      // Morph close to merge nearby pixels into coherent blobs
      const closed = new cv.Mat()
      cv.morphologyEx(classMask, closed, cv.MORPH_CLOSE, kernel)

      const labels = new cv.Mat()
      const stats = new cv.Mat()
      const centroids = new cv.Mat()
      try {
        const numLabels = cv.connectedComponentsWithStats(
          closed, labels, stats, centroids, 8, cv.CV_32S,
        )

        const classBlobs = []
        for (let i = 1; i < numLabels; i++) {
          const areaCv = stats.intAt(i, cv.CC_STAT_AREA)
          if (areaCv < minAreaCv || areaCv > maxAreaCv) continue
          classBlobs.push({
            x: Math.round(stats.intAt(i, cv.CC_STAT_LEFT) * invScale),
            y: Math.round(stats.intAt(i, cv.CC_STAT_TOP) * invScale),
            w: Math.round(stats.intAt(i, cv.CC_STAT_WIDTH) * invScale),
            h: Math.round(stats.intAt(i, cv.CC_STAT_HEIGHT) * invScale),
            cx: Math.round(centroids.doubleAt(i, 0) * invScale),
            cy: Math.round(centroids.doubleAt(i, 1) * invScale),
            area: Math.round(areaCv * invScale * invScale),
            color_class: cls.id,
          })
        }
        // Per-class cap, biggest first
        classBlobs.sort((a, b) => b.area - a.area)
        for (const b of classBlobs.slice(0, MAX_BLOBS_PER_CLASS)) allBlobs.push(b)
      } finally {
        closed.delete()
        labels.delete()
        stats.delete()
        centroids.delete()
      }
    }

    // Overall cap, biggest first across all classes
    allBlobs.sort((a, b) => b.area - a.area)
    return {
      width: nativeW,
      height: nativeH,
      blobs: allBlobs.slice(0, MAX_BLOBS_TOTAL),
    }
  } finally {
    src.delete(); rgb.delete(); hsv.delete()
    if (lab) lab.delete()
    if (exgMask) exgMask.delete()
    kernel.delete()
    for (const m of classMasks) m.delete()
  }
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data
  try {
    await whenCvReady()
    if (type === 'ping') {
      self.postMessage({ id, ok: true, result: 'ready' })
      return
    }
    if (type === 'findBlobs') {
      const result = findBlobs(payload.imageBitmap, payload.classes)
      self.postMessage({ id, ok: true, result })
      payload.imageBitmap.close?.()
      return
    }
    self.postMessage({ id, ok: false, error: `unknown type: ${type}` })
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) })
  }
}
