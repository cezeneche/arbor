import { Suspense } from 'react'
import VerifyEmailForm from './VerifyEmailForm'

// useSearchParams (in VerifyEmailForm) must sit inside a Suspense boundary.
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  )
}
