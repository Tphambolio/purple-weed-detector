// Gemini Vision client. Two modes:
//   - Direct: calls generativelanguage.googleapis.com using a key from
//     VITE_GEMINI_API_KEY (local dev only — never ship a build with the
//     key embedded).
//   - Proxy:  POSTs to a server-side proxy that holds the key. The proxy
//     URL comes from VITE_API_BASE_URL at build time. If unset, falls back
//     to the deployed Cloudflare Pages function on the same origin so
//     existing local-dev workflows keep working without changes.
//
// The interface is the same: analyzeCrop(jpegBlob, weeds) -> result object.

const MODEL = 'gemini-2.5-flash'

// Resolve the proxy endpoint:
//   - Set VITE_API_BASE_URL=https://<region>-<project>.cloudfunctions.net/gemini-proxy
//     for the GCP Cloud Function deployment.
//   - Leave it unset to keep hitting the original Cloudflare Pages function
//     at /api/gemini on the same origin.
const PROXY_URL =
  import.meta.env.VITE_API_BASE_URL || 'https://purple-weed-detector.pages.dev/api/gemini'

const WEED_DESCRIPTIONS = {
  purple_loosestrife: 'Purple Loosestrife (Lythrum salicaria) — tall spikes of magenta-purple flowers, wetland edges',
  thistle: 'thistle species (Canada Thistle Cirsium arvense, Nodding Thistle Carduus nutans) — spiny leaves, pink-purple flower heads',
  dames_rocket: "Dame's Rocket (Hesperis matronalis) — 4-petalled purple/white flowers, common urban edges",
}

function buildCropPrompt(weeds) {
  let target, hint
  if (weeds.includes('any')) {
    target = 'any purple/magenta flowering weed or invasive plant'
    hint = 'Possible species: Purple Loosestrife (Lythrum salicaria), Canada Thistle (Cirsium arvense), Nodding Thistle (Carduus nutans), Dame\'s Rocket (Hesperis matronalis).'
  } else {
    target = weeds.map(w => WEED_DESCRIPTIONS[w]).filter(Boolean).join('; ')
    hint = ''
  }

  return `This is a tight crop from a drone aerial photo (~150 m altitude) centered on a purple object.
Identify whether the purple thing in this crop is ${target}, or something else (purple non-plant: tarp, jacket, paint, dye, vehicle).
${hint}

Respond ONLY with a JSON object — no markdown, no extra text:
{
  "is_plant": true or false,
  "species": "species name or 'unknown' or 'not a plant'",
  "confidence": "high" | "medium" | "low",
  "description": "one short sentence describing the purple object"
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
 * Public entry point. `examples` is optional — if present, each will be
 * sent to Gemini as an in-context example before the new crop is classified.
 */
export async function analyzeCrop(jpegBlob, weeds, { examples = [] } = {}) {
  const prompt = buildCropPrompt(weeds)
  const raw = USE_PROXY
    ? await callProxy(jpegBlob, prompt, examples)
    : await callDirect(jpegBlob, prompt, examples)
  const parsed = parseJsonLoose(raw)
  if (parsed) return parsed
  return {
    is_plant: false,
    species: 'unknown',
    confidence: 'low',
    description: raw.slice(0, 200),
  }
}
