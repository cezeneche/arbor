'use client'

import { useState } from 'react'

export function CopyCode({ label, code }: { label: string; code: string }) {
  const [status, setStatus] = useState('')

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setStatus('Copied')
    } catch {
      setStatus('Copy unavailable; select the text below')
    }
  }

  return (
    <div className="mk-code-block">
      <div className="mk-code-toolbar">
        <span>{label}</span>
        <button type="button" onClick={copy}>
          Copy
        </button>
        <span role="status" className="mk-code-status">
          {status}
        </span>
      </div>
      <pre tabIndex={0} role="region" aria-label={`${label} example`}>
        <code>{code}</code>
      </pre>
    </div>
  )
}
