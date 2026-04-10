// Web Worker that runs all opencv.js work off the main thread.
// Main thread sends an ImageBitmap; we draw it to an OffscreenCanvas,
// run HSV mask + morph close + connected components, and return the
// blob list (rescaled back to native pixel coords).

// Relative path: resolves against the worker's own URL, so it works
// whether the worker is served from origin root or a path prefix
// (e.g. /<bucket>/cv-worker.js → /<bucket>/opencv.js).
importScripts('./opencv.js')

const PURPLE_LOWER = [120, 30, 30]
const PURPLE_UPPER = [165, 255, 255]
const MIN_AREA_PX_NATIVE = 30
const MAX_AREA_PX_NATIVE = 100_000
const MAX_BLOBS_PER_IMAGE = 20
const MAX_CV_WIDTH = 1500
const CLOSE_KERNEL_SIZE = 9

let cvReady = null

function whenCvReady() {
  if (cvReady) return cvReady
  cvReady = new Promise((resolve) => {
    if (self.cv && self.cv.Mat) return resolve()
    // opencv.js script sets self.cv asynchronously and calls
    // self.Module.onRuntimeInitialized when WASM is ready.
    if (self.cv && typeof self.cv.then === 'function') {
      // Newer opencv.js exposes cv as a Promise.
      self.cv.then(() => resolve())
      return
    }
    self.Module = self.Module || {}
    self.Module.onRuntimeInitialized = () => resolve()
  })
  return cvReady
}

function findBlobs(imageBitmap) {
  const cv = self.cv
  const nativeW = imageBitmap.width
  const nativeH = imageBitmap.height
  const scale = nativeW > MAX_CV_WIDTH ? MAX_CV_WIDTH / nativeW : 1
  const cvW = Math.round(nativeW * scale)
  const cvH = Math.round(nativeH * scale)

  const minAreaCv = Math.max(2, Math.round(MIN_AREA_PX_NATIVE * scale * scale))
  const maxAreaCv = Math.round(MAX_AREA_PX_NATIVE * scale * scale)

  const off = new OffscreenCanvas(cvW, cvH)
  const ctx = off.getContext('2d')
  ctx.drawImage(imageBitmap, 0, 0, cvW, cvH)
  const imageData = ctx.getImageData(0, 0, cvW, cvH)

  const src = cv.matFromImageData(imageData)
  const rgb = new cv.Mat()
  const hsv = new cv.Mat()
  const mask = new cv.Mat()
  const closed = new cv.Mat()
  const labels = new cv.Mat()
  const stats = new cv.Mat()
  const centroids = new cv.Mat()
  const lower = new cv.Mat(src.rows, src.cols, cv.CV_8UC3, [...PURPLE_LOWER, 0])
  const upper = new cv.Mat(src.rows, src.cols, cv.CV_8UC3, [...PURPLE_UPPER, 0])
  const kernel = cv.Mat.ones(CLOSE_KERNEL_SIZE, CLOSE_KERNEL_SIZE, cv.CV_8U)

  try {
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)
    cv.inRange(hsv, lower, upper, mask)
    cv.morphologyEx(mask, closed, cv.MORPH_CLOSE, kernel)

    const numLabels = cv.connectedComponentsWithStats(
      closed, labels, stats, centroids, 8, cv.CV_32S,
    )

    const invScale = 1 / scale
    const blobs = []
    for (let i = 1; i < numLabels; i++) {
      const areaCv = stats.intAt(i, cv.CC_STAT_AREA)
      if (areaCv < minAreaCv || areaCv > maxAreaCv) continue
      blobs.push({
        x: Math.round(stats.intAt(i, cv.CC_STAT_LEFT) * invScale),
        y: Math.round(stats.intAt(i, cv.CC_STAT_TOP) * invScale),
        w: Math.round(stats.intAt(i, cv.CC_STAT_WIDTH) * invScale),
        h: Math.round(stats.intAt(i, cv.CC_STAT_HEIGHT) * invScale),
        cx: Math.round(centroids.doubleAt(i, 0) * invScale),
        cy: Math.round(centroids.doubleAt(i, 1) * invScale),
        area: Math.round(areaCv * invScale * invScale),
      })
    }
    blobs.sort((a, b) => b.area - a.area)
    return { width: nativeW, height: nativeH, blobs: blobs.slice(0, MAX_BLOBS_PER_IMAGE) }
  } finally {
    src.delete(); rgb.delete(); hsv.delete(); mask.delete(); closed.delete()
    labels.delete(); stats.delete(); centroids.delete()
    lower.delete(); upper.delete(); kernel.delete()
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
      const result = findBlobs(payload.imageBitmap)
      self.postMessage({ id, ok: true, result })
      // Caller transferred the bitmap in; close it now to free memory.
      payload.imageBitmap.close?.()
      return
    }
    self.postMessage({ id, ok: false, error: `unknown type: ${type}` })
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) })
  }
}
