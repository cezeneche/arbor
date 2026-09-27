import { redirect } from 'next/navigation'

// Retired. Asking questions of your records happens on Records, where the
// answer sits beside the records themselves. Kept as a redirect so an existing
// bookmark lands somewhere sensible.
export default function QueryPage() {
  redirect('/records')
}
