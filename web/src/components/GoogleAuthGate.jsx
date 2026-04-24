import { useEffect, useState } from 'react'

const CLIENT_ID   = '3812854088-90tkc9c1kle914dmo7gal7ds6n4ae50a.apps.googleusercontent.com'
const ALLOWED_DOMAIN = 'edmonton.ca'
const SESSION_KEY = 'gid_token'

export function getStoredToken() {
  return sessionStorage.getItem(SESSION_KEY)
}

function decodePayload(credential) {
  try {
    return JSON.parse(atob(credential.split('.')[1]))
  } catch {
    return null
  }
}

export default function GoogleAuthGate({ children }) {
  const [token, setToken]         = useState(() => sessionStorage.getItem(SESSION_KEY))
  const [error, setError]         = useState(null)
  const [scriptReady, setScript]  = useState(!!window.google?.accounts?.id)

  // Load Google Identity Services script once
  useEffect(() => {
    if (window.google?.accounts?.id) { setScript(true); return }
    const s  = document.createElement('script')
    s.src    = 'https://accounts.google.com/gsi/client'
    s.async  = true
    s.defer  = true
    s.onload = () => setScript(true)
    document.head.appendChild(s)
  }, [])

  // Init Sign-In once script is ready and user is not yet authed
  useEffect(() => {
    if (!scriptReady || token) return

    window.google.accounts.id.initialize({
      client_id:   CLIENT_ID,
      callback:    handleCredential,
      auto_select: true,
    })

    const btn = document.getElementById('gsi-button')
    if (btn) {
      window.google.accounts.id.renderButton(btn, {
        theme: 'filled_black',
        size:  'large',
        text:  'signin_with',
        shape: 'rectangular',
        width: 280,
      })
    }

    window.google.accounts.id.prompt()
  }, [scriptReady, token])

  const handleCredential = ({ credential }) => {
    const payload = decodePayload(credential)
    if (!payload) { setError('Invalid token — please try again.'); return }

    if (!payload.email?.endsWith(`@${ALLOWED_DOMAIN}`)) {
      setError(`Access is restricted to @${ALLOWED_DOMAIN} accounts. You signed in as ${payload.email}.`)
      window.google.accounts.id.revoke(payload.email, () => {})
      return
    }

    sessionStorage.setItem(SESSION_KEY, credential)
    setToken(credential)
    setError(null)
  }

  if (token) return children

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-logo">🌿</div>
        <h1 className="auth-title">Purple Weed Detector</h1>
        <p className="auth-org">City of Edmonton · Urban Forestry</p>
        <p className="auth-hint">Sign in with your <strong>@edmonton.ca</strong> Google account.</p>

        {error && <div className="auth-error">{error}</div>}

        <div id="gsi-button" className="auth-btn-wrap" />
        {!scriptReady && <p className="auth-loading">Loading…</p>}
      </div>
    </div>
  )
}
