import { redirect } from 'next/navigation'

// Benchmarks now live as a view inside Records (Records -> Benchmarks toggle).
// Kept as a redirect so any existing bookmark lands somewhere sensible.
export default function BenchmarksPage() {
  redirect('/records?view=benchmarks')
}
