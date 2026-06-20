'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { colours, typography, spacing } from '@/lib/design-system'

// Gap 10 — completes SSO by exchanging the one-time token for a NextAuth session.
export default function SsoCompletePage() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token')
  const [failed, setFailed] = useState(false)
  const error = failed || !token

  useEffect(() => {
    if (!token) return
    signIn('workos', { token, redirect: false }).then((res) => {
      if (res?.ok) router.push('/dashboard')
      else setFailed(true)
    })
  }, [token, router])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: colours.background }}>
      <div style={{ textAlign: 'center', padding: spacing[5] }}>
        <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.light, color: error ? colours.red : colours.textSecondary, margin: 0 }}>
          {error ? 'Sign-in could not be completed. Please try again.' : 'Completing sign-in…'}
        </p>
        {error && (
          <a href="/login" style={{ display: 'inline-block', marginTop: spacing[2], fontSize: typography.sizes.sm, color: colours.navy, textDecoration: 'none' }}>
            Back to sign in
          </a>
        )}
      </div>
    </div>
  )
}
