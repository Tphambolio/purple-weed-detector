// Browser-side prefilter — main-thread API that delegates the heavy
// opencv.js work to a Web Worker (public/cv-worker.js).
//
// Why a worker: opencv.js is synchronous WebAssembly. Running it on the
// main thread freezes the UI for seconds at a time on full-resolution
// drone photos. The worker isolates it completely.

let workerInstance = null
let nextId = 1
const pending = new Map()

function getWorker() {
  if (workerInstance) return workerInstance
  workerInstance = new Worker('/cv-worker.js')
  workerInstance.onmessage = (e) => {
    const { id, ok, result, error } = e.data
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if (ok) p.resolve(result)
    else p.reject(new Error(error))
  }
  workerInstance.onerror = (e) => {
    // Reject all pending if the worker crashes.
    for (const { reject } of pending.values()) reject(new Error(`worker error: ${e.message}`))
    pending.clear()
  }
  return workerInstance
}

function send(type, payload, transfer = []) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, type, payload }, transfer)
  })
}

/** One-time worker warm-up. Resolves once opencv.js WASM is initialized. */
export async function warmUpCv() {
  await send('ping', {})
}

export async function fileToImage(file) {
  // We still need an HTMLImageElement on the main thread for the gallery preview
  // and for the per-blob crop step (which uses a regular canvas).
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}

/**
 * Find purple blobs in a File. Decodes via createImageBitmap, transfers
 * to the worker (zero-copy), and returns native-pixel blob coords.
 */
export async function findPurpleBlobs(file) {
  const bitmap = await createImageBitmap(file)
  return await send('findBlobs', { imageBitmap: bitmap }, [bitmap])
}

/**
 * Crop a padded context window around a blob and return it as a JPEG Blob.
 * Uses native-resolution pixels from an HTMLImageElement on the main thread.
 */
const PAD_RATIO = 1.5
const MIN_CROP_SIDE = 384

export async function cropBlobToJpegBlob(image, blob) {
  const w = image.naturalWidth || image.width
  const h = image.naturalHeight || image.height

  const padX = Math.max(Math.round(blob.w * PAD_RATIO), Math.floor((MIN_CROP_SIDE - blob.w) / 2))
  const padY = Math.max(Math.round(blob.h * PAD_RATIO), Math.floor((MIN_CROP_SIDE - blob.h) / 2))

  const x1 = Math.max(0, blob.x - padX)
  const y1 = Math.max(0, blob.y - padY)
  const x2 = Math.min(w, blob.x + blob.w + padX)
  const y2 = Math.min(h, blob.y + blob.h + padY)
  const cw = x2 - x1
  const ch = y2 - y1

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, x1, y1, cw, ch, 0, 0, cw, ch)

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      0.88,
    )
  })
}
