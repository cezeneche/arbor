// Keep audience and plan interest in the on-site pilot request journey.
export function pilotRequestHref(audience?: 'supplier' | 'buyer', plan?: string): string {
  const params = new URLSearchParams()
  if (audience) params.set('audience', audience)
  if (plan) params.set('plan', plan)
  return `/request-access${params.size ? `?${params.toString()}` : ''}`
}
