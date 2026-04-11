// Tiny perceptual hash (dHash 8x8) used to recognise visually-similar
// crops across scans, so a verdict the user already gave can be inherited
// without re-calling Gemini.
//
// Algorithm: draw the image into a 9x8 canvas, convert to grayscale, then
// for each row compare adjacent pixels — 8 comparisons × 8 rows = 64 bits.
// The result is a 16-character hex string. Hamming distance between two
// pHashes counts how many bits differ; small distances mean similar images.

/**
 * Compute the dHash of a JPEG / PNG Blob. Returns a 16-char hex string.
 */
export async function computeDhash(blob) {
  const bitmap = await createImageBitmap(blob)
  try {
    const w = 9
    const h = 8
    const canvas = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h })
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)

    // Convert to grayscale and walk row-major comparing each pixel to its right neighbour.
    const bits = new Uint8Array(64)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i  = (y * w + x) * 4
        const i2 = (y * w + (x + 1)) * 4
        const g1 = (data[i]   + data[i  + 1] + data[i  + 2]) / 3
        const g2 = (data[i2]  + data[i2 + 1] + data[i2 + 2]) / 3
        bits[y * 8 + x] = g1 > g2 ? 1 : 0
      }
    }

    let hex = ''
    for (let nibble = 0; nibble < 16; nibble++) {
      let v = 0
      for (let b = 0; b < 4; b++) v = (v << 1) | bits[nibble * 4 + b]
      hex += v.toString(16)
    }
    return hex
  } finally {
    bitmap.close?.()
  }
}

/**
 * Hamming distance between two equal-length hex strings. Counts the
 * number of bits that differ.
 */
export function hammingHex(a, b) {
  if (a.length !== b.length) return Infinity
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}

/**
 * Resize a JPEG Blob to a small square thumbnail and return a base64 string
 * (no `data:` prefix). Used for storing few-shot examples that future
 * Gemini calls send back as inline_data parts.
 *
 * Default 128x128 q=0.7 → ~3 KB per thumbnail.
 */
export async function blobToThumbnailB64(blob, side = 128, quality = 0.7) {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(side, side)
      : Object.assign(document.createElement('canvas'), { width: side, height: side })
    const ctx = canvas.getContext('2d')
    // Cover-fit the bitmap into the square so plant fills the frame.
    const scale = Math.max(side / bitmap.width, side / bitmap.height)
    const dw = bitmap.width * scale
    const dh = bitmap.height * scale
    ctx.drawImage(bitmap, (side - dw) / 2, (side - dh) / 2, dw, dh)
    const out = await canvas.convertToBlob
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
      : await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality))
    return await blobToBase64(out)
  } finally {
    bitmap.close?.()
  }
}

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer()
  let s = ''
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}
