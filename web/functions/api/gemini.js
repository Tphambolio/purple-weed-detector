// Cloudflare Pages Function — Gemini proxy.
// Verifies a Google ID token (JWT) in Authorization: Bearer <token>,
// enforces the @edmonton.ca domain + matching audience, then forwards
// crops to Gemini. The API key never leaves the server.
//
// Environment variables (set via `wrangler pages secret put` or dashboard):
//   GEMINI_API_KEY       — Google AI Studio key
//   GOOGLE_CLIENT_ID     — OAuth 2.0 Web client ID (audience check)
//   ALLOWED_DOMAIN       — optional, defaults to 'edmonton.ca'

const MODEL = 'gemini-2.5-flash'
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])

// In-memory cache per Worker isolate. JWKS rotates ~daily; 1-hour TTL is safe.
let JWKS_CACHE = { keys: null, fetchedAt: 0 }
const JWKS_TTL_MS = 60 * 60 * 1000

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...extra,
  }
}

function b64urlToUint8(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  const raw = atob(str)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function b64urlToJson(str) {
  return JSON.parse(new TextDecoder().decode(b64urlToUint8(str)))
}

async function fetchJwks() {
  const now = Date.now()
  if (JWKS_CACHE.keys && now - JWKS_CACHE.fetchedAt < JWKS_TTL_MS) {
    return JWKS_CACHE.keys
  }
  const res = await fetch(GOOGLE_JWKS_URL, { cf: { cacheTtl: 3600 } })
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`)
  const data = await res.json()
  JWKS_CACHE = { keys: data.keys, fetchedAt: now }
  return data.keys
}

async function importRsaKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

async function verifyGoogleIdToken(jwt, audience, allowedDomain) {
  const parts = jwt.split('.')
  if (parts.length !== 3) throw new Error('Malformed JWT')

  const header = b64urlToJson(parts[0])
  const payload = b64urlToJson(parts[1])
  const signature = b64urlToUint8(parts[2])
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)

  if (header.alg !== 'RS256') throw new Error(`Unsupported alg: ${header.alg}`)

  const jwks = await fetchJwks()
  const jwk = jwks.find(k => k.kid === header.kid)
  if (!jwk) throw new Error('Signing key not found in JWKS')

  const key = await importRsaKey(jwk)
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    signature,
    signed,
  )
  if (!ok) throw new Error('Signature verification failed')

  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && now >= payload.exp) throw new Error('Token expired')
  if (payload.nbf && now < payload.nbf) throw new Error('Token not yet valid')
  if (payload.iat && now + 30 < payload.iat) throw new Error('Token issued in the future')

  if (!GOOGLE_ISSUERS.has(payload.iss)) throw new Error(`Bad issuer: ${payload.iss}`)
  if (payload.aud !== audience) throw new Error('Audience mismatch')
  if (!payload.email_verified) throw new Error('Email not verified')

  const email = (payload.email || '').toLowerCase()
  const hd = (payload.hd || '').toLowerCase()
  const domainOk = email.endsWith(`@${allowedDomain}`) && (!hd || hd === allowedDomain)
  if (!domainOk) throw new Error(`Access restricted to @${allowedDomain}`)

  return payload
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() })
}

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) {
    return new Response('GEMINI_API_KEY not configured', { status: 500, headers: cors() })
  }
  if (!env.GOOGLE_CLIENT_ID) {
    return new Response('GOOGLE_CLIENT_ID not configured', { status: 500, headers: cors() })
  }

  const allowedDomain = (env.ALLOWED_DOMAIN || 'edmonton.ca').toLowerCase()
  const auth = request.headers.get('Authorization') || ''
  const match = auth.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return new Response('Missing bearer token', { status: 401, headers: cors() })
  }

  try {
    await verifyGoogleIdToken(match[1], env.GOOGLE_CLIENT_ID, allowedDomain)
  } catch (e) {
    return new Response(`Unauthorized: ${e.message}`, { status: 401, headers: cors() })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400, headers: cors() })
  }

  const { image_b64, prompt } = body || {}
  if (!image_b64 || !prompt) {
    return new Response('Missing image_b64 or prompt', { status: 400, headers: cors() })
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`
  const geminiBody = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'image/jpeg', data: image_b64 } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 512,
      thinkingConfig: { thinkingBudget: 0 },
    },
  }

  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiBody),
  })

  if (!upstream.ok) {
    const errText = await upstream.text()
    return new Response(`Gemini upstream ${upstream.status}: ${errText.slice(0, 300)}`, {
      status: 502,
      headers: cors(),
    })
  }

  const data = await upstream.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: cors({ 'Content-Type': 'application/json' }),
  })
}
