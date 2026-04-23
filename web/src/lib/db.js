// IndexedDB cache via Dexie. Replaces backend/database.py.
// Keyed by content hash so the same photo isn't re-analyzed across uploads.

import Dexie from 'dexie'

export const db = new Dexie('purple_weed_detector')
db.version(1).stores({
  results: 'hash, filename, scanned_at',
})
db.version(2).stores({
  results: 'hash, filename, scanned_at',
  annotations: '++id, imageHash, species, created_at',
})

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

export async function saveAnnotation(annotation) {
  return await db.annotations.add({ ...annotation, created_at: new Date().toISOString() })
}

export async function getAnnotationsForImage(imageHash) {
  return await db.annotations.where('imageHash').equals(imageHash).toArray()
}

export async function getAllAnnotations() {
  return await db.annotations.orderBy('created_at').reverse().toArray()
}

export async function deleteAnnotation(id) {
  await db.annotations.delete(id)
}
