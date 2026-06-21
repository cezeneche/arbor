import { redirect } from 'next/navigation'

// Retired. The completeness snapshot now lives on the Records screen and the
// quarter-by-quarter trends moved to Records → Trends. Kept as a redirect so any
// existing bookmark lands somewhere sensible rather than 404-ing.
export default function AnalyticsPage() {
  redirect('/records?view=trends')
}
