// Cloudflare Pages Function — Gemini proxy.
// Holds the API key in env, checks a shared password, and forwards
// crops to the Gemini API. Frontend never sees the key.
//
// Environment variables (set via `wrangler pages secret put` or dashboard):
//   GEMINI_API_KEY    — your Google AI Studio key
//   ACCESS_PASSWORD   — shared secret callers must send in X-Access-Password

const MODEL = 'gemini-2.5-flash'

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Access-Password',
    ...extra,
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() })
}

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY) {
    return new Response('GEMINI_API_KEY not configured', { status: 500, headers: cors() })
  }
  if (!env.ACCESS_PASSWORD) {
    return new Response('ACCESS_PASSWORD not configured', { status: 500, headers: cors() })
  }

  const supplied = request.headers.get('X-Access-Password') || ''
  if (supplied !== env.ACCESS_PASSWORD) {
    return new Response('Unauthorized', { status: 401, headers: cors() })
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
