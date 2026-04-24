// Gemini Vision client. Always calls the same-origin /api/gemini proxy;
// the Cloudflare Pages Function holds the API key and verifies the caller's
// Google ID token (@edmonton.ca only). No direct Gemini calls from the browser.

const PROXY_URL = import.meta.env.VITE_API_BASE_URL || '/api/gemini'

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

async function callProxy(jpegBlob, prompt) {
  const token = sessionStorage.getItem('gid_token') || ''
  if (!token) throw new Error('Not signed in. Reload and sign in with your @edmonton.ca account.')

  const b64 = await blobToBase64(jpegBlob)
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ image_b64: b64, prompt }),
  })
  if (res.status === 401) {
    sessionStorage.removeItem('gid_token')
    throw new Error('Session expired. Reload and sign in again.')
  }
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Proxy ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.text || ''
}

export async function analyzeCrop(jpegBlob, weeds) {
  const prompt = buildCropPrompt(weeds)
  const raw = await callProxy(jpegBlob, prompt)
  const parsed = parseJsonLoose(raw)
  if (parsed) return parsed
  return {
    is_plant: false,
    species: 'unknown',
    confidence: 'low',
    description: raw.slice(0, 200),
  }
}
