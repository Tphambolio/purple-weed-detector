// Gemini Vision client. Two modes:
//   - Direct: calls generativelanguage.googleapis.com using a key from
//     VITE_GEMINI_API_KEY (local dev only — never ship a build with the
//     key embedded).
//   - Proxy:  POSTs to a server-side proxy that holds the key. The proxy
//     URL comes from VITE_API_BASE_URL at build time. If unset, falls back
//     to the deployed Cloudflare Pages function on the same origin so
//     existing local-dev workflows keep working without changes.
//
// Public interface: analyzeCrop(jpegBlob, weeds, opts) -> result object.
// `opts.targetSpecies` (array of species objects) and `opts.colorClass`
// drive species-aware prompting; `opts.photoDate` drives bloom-status
// filtering. `opts.examples` is the few-shot in-context calibration set.

import { isSpeciesActive } from './phenology.js'
import { COLOR_CLASSES } from './colorClasses.js'

const MODEL = 'gemini-2.5-flash'

// Resolve the proxy endpoint:
//   - Set VITE_API_BASE_URL=https://<region>-<project>.cloudfunctions.net/gemini-proxy
//     for the GCP Cloud Function deployment.
//   - Leave it unset to keep hitting the original Cloudflare Pages function
//     at /api/gemini on the same origin.
const PROXY_URL =
  import.meta.env.VITE_API_BASE_URL || 'https://purple-weed-detector.pages.dev/api/gemini'

/**
 * Build the Gemini prompt for a single crop.
 *
 * The prompt tells Gemini:
 *   1. The crop is from a drone aerial (altitude / GSD context).
 *   2. Which colour class the upstream HSV mask flagged it as.
 *   3. The candidate species to choose from — filtered to those that match
 *      the colour class AND are in flower / identifiable on the photo date.
 *   4. The known confusion species to explicitly rule out.
 *   5. Return a strict JSON object using species_id from our registry.
 */
function buildCropPrompt({ targetSpecies, colorClass, photoDate }) {
  const date = photoDate ? new Date(photoDate) : new Date()
  const dateStr = date.toISOString().slice(0, 10)
  const colorLabel = COLOR_CLASSES[colorClass]?.label || 'flagged'

  // Narrow candidates to those that match the colour class AND are in bloom.
  // If nothing survives, fall back to all selected species (the user may have
  // overridden the date filter, or the colour mask may have caught a species
  // outside its main bloom window).
  let candidates = (targetSpecies || []).filter(s => s.color_class === colorClass)
  const inBloom = candidates.filter(s => isSpeciesActive(s, date))
  if (inBloom.length > 0) candidates = inBloom

  // Format candidate list with hints + confusion species
  const candidateLines = candidates.map(s => {
    const conf = (s.confusion_species && s.confusion_species.length > 0)
      ? ` Not to be confused with: ${s.confusion_species.join(', ')}.`
      : ''
    return `- ${s.id} → ${s.label} (${s.scientific}). ${s.gemini_hint}.${conf}`
  }).join('\n')

  const candidateIds = candidates.map(s => `"${s.id}"`).join(', ')

  return `This is a tight crop from a drone aerial photo (~50–150 m altitude) of an Edmonton-area natural area, taken on ${dateStr}.
The upstream HSV mask flagged this crop as colour class "${colorLabel}".

Identify which species (if any) is shown. Candidates currently in season for this colour class:

${candidateLines || '(no in-season candidates of this colour — judge against general invasive plant knowledge)'}

If the crop shows none of these and is some other plant or a non-plant object (tarp, jacket, vehicle, paint, sign), say so. Be especially careful to distinguish each candidate from its listed confusion species.

Respond ONLY with a JSON object — no markdown, no extra text:
{
  "is_plant": true or false,
  "species_id": ${candidateIds ? `one of [${candidateIds}]` : '"unknown"'} or "unknown" or "not_a_plant",
  "species": "common name string for human display",
  "confidence": "high" | "medium" | "low",
  "description": "one short sentence describing what you see and which features matched"
}`
}

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer()
  // Browser-safe base64 of binary bytes.
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function parseJsonLoose(text) {
  if (!text) return null
  let s = text.trim()
  if (s.startsWith('```')) {
    const parts = s.split('```')
    s = (parts[1] || s).replace(/^json/i, '').trim()
  }
  try { return JSON.parse(s) } catch { return null }
}

/**
 * Build the multi-part `parts` array for a Gemini request.
 * If `examples` is non-empty, prepends them as alternating text+image pairs
 * so the model gets in-context calibration before classifying the new crop.
 */
function buildGeminiParts(newCropB64, prompt, examples = []) {
  const parts = []
  examples.forEach((ex, i) => {
    parts.push({ text: `Example ${i + 1} — ${ex.label}:` })
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: ex.thumb_b64 } })
  })
  if (examples.length > 0) {
    parts.push({ text: 'Now classify this crop using the examples above as calibration:' })
  }
  parts.push({ inline_data: { mime_type: 'image/jpeg', data: newCropB64 } })
  parts.push({ text: prompt })
  return parts
}

async function callDirect(jpegBlob, prompt, examples) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY not set (Phase 1 local dev only)')

  const b64 = await blobToBase64(jpegBlob)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`
  const body = {
    contents: [{
      parts: buildGeminiParts(b64, prompt, examples),
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 512,
      thinkingConfig: { thinkingBudget: 0 },
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`)
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return text
}

async function callProxy(jpegBlob, prompt, examples) {
  const password = localStorage.getItem('access_password') || ''
  const b64 = await blobToBase64(jpegBlob)
  const body = { image_b64: b64, prompt }
  if (examples && examples.length > 0) {
    // Compact field names — proxy expects {b64, label}
    body.examples = examples.map(e => ({ b64: e.thumb_b64, label: e.label }))
  }
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Password': password,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Proxy ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.text || ''
}

// Auto-select: if a same-origin /api/gemini exists at build time, use proxy.
// Phase 1 just uses the direct path.
const USE_PROXY = !!import.meta.env.VITE_USE_PROXY

/**
 * Public entry point.
 *
 * @param {Blob}   jpegBlob          Cropped JPEG to classify
 * @param {Array}  _weeds            Legacy positional, kept for back-compat
 * @param {Object} opts
 * @param {Array}  opts.examples     Few-shot in-context examples
 * @param {Array}  opts.targetSpecies  Resolved species objects from registry
 * @param {string} opts.colorClass   Colour class id the upstream mask used
 * @param {Date|string} opts.photoDate  Photo capture date for bloom filtering
 */
export async function analyzeCrop(jpegBlob, _weeds, {
  examples = [],
  targetSpecies = [],
  colorClass = null,
  photoDate = null,
} = {}) {
  const prompt = buildCropPrompt({ targetSpecies, colorClass, photoDate })
  const raw = USE_PROXY
    ? await callProxy(jpegBlob, prompt, examples)
    : await callDirect(jpegBlob, prompt, examples)
  const parsed = parseJsonLoose(raw)
  if (parsed) {
    // Normalise: legacy callers expect `species` to be the human label and
    // `is_plant` to indicate "this is one of our target species". The new
    // prompt also asks for `species_id` (registry id) so we keep both.
    const species_id = parsed.species_id || null
    const is_target = !!(species_id && species_id !== 'unknown' && species_id !== 'not_a_plant')
    return {
      is_plant: is_target || !!parsed.is_plant,
      species_id,
      species: parsed.species || species_id || 'unknown',
      confidence: parsed.confidence || 'low',
      description: parsed.description || '',
    }
  }
  return {
    is_plant: false,
    species_id: null,
    species: 'unknown',
    confidence: 'low',
    description: raw.slice(0, 200),
  }
}
