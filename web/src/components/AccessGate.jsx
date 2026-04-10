import { useEffect, useState } from 'react'

// Tiny settings panel: shown only in proxy mode (Cloudflare deploy).
// User enters the shared password once; it's stored in localStorage and
// sent on every /api/gemini request via the X-Access-Password header.
export default function AccessGate() {
  const [pw, setPw] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setPw(localStorage.getItem('access_password') || '')
  }, [])

  const save = () => {
    localStorage.setItem('access_password', pw)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const isSet = !!localStorage.getItem('access_password')

  return (
    <div className="access-gate">
      <label>Access password</label>
      <input
        type="password"
        value={pw}
        onChange={e => setPw(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && save()}
        placeholder={isSet ? '••••••••' : 'Enter the shared password'}
        autoComplete="off"
        spellCheck={false}
      />
      <button className="btn-secondary" onClick={save} disabled={!pw}>
        {saved ? 'Saved' : 'Save'}
      </button>
    </div>
  )
}
