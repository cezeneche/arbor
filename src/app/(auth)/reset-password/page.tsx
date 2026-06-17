import { Suspense } from 'react'
import ResetPasswordForm from './ResetPasswordForm'

// useSearchParams (in ResetPasswordForm) must sit inside a Suspense boundary.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
