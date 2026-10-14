import { redirect } from 'next/navigation'
import { requirePageSession } from '@/lib/page-auth'
import { getSessionUser } from '@/lib/session'
import { loadDashboard, searchDashboard } from '@/lib/layer3/dashboard-data'
import { Dashboard } from '@/components/overview/Dashboard'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>
}) {
  const session = await requirePageSession()
  const user = getSessionUser(session)
  if (!user.entityId) redirect('/login')
  const params = await searchParams
  const view =
    params.view === 'work' || params.view === 'organisation'
      ? params.view
      : user.role === 'CONTRIBUTOR'
        ? 'work'
        : 'organisation'
  const query = typeof params.q === 'string' ? params.q.trim().slice(0, 120) : ''
  const now = new Date()
  const [data, results] = await Promise.all([
    loadDashboard(user.entityId, user.id, now),
    query ? searchDashboard(user.entityId, query) : Promise.resolve([]),
  ])
  if (!data) redirect('/login')
  return (
    <Dashboard
      data={data}
      view={view}
      query={query}
      results={results}
      now={now}
      canAssign={user.role === 'ADMIN'}
      canWrite={user.role === 'ADMIN' || user.role === 'CONTRIBUTOR'}
    />
  )
}
