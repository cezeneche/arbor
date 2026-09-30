import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requirePageSession } from '@/lib/page-auth'
import { getSessionUser } from '@/lib/session'

export const metadata: Metadata = { title: 'Enquiry review | Arbor' }

const statuses = ['NEW', 'IN_PROGRESS', 'CLOSED'] as const
type Status = (typeof statuses)[number]

async function requireOperator() {
  const session = await requirePageSession()
  const user = await prisma.user.findUnique({
    where: { id: getSessionUser(session).id as string },
    select: { isPlatformAdmin: true },
  })
  if (!user?.isPlatformAdmin) notFound()
}

async function updateEnquiry(formData: FormData) {
  'use server'
  await requireOperator()
  const type = formData.get('type')
  const id = formData.get('id')
  const status = formData.get('status')
  if ((type !== 'pilot' && type !== 'institutional') || typeof id !== 'string' || !id || !statuses.includes(status as Status)) {
    throw new Error('Invalid enquiry update')
  }
  if (type === 'pilot') {
    await prisma.pilotEnquiry.update({ where: { id }, data: { status: status as Status } })
  } else {
    await prisma.institutionalEnquiry.update({ where: { id }, data: { status: status as Status } })
  }
  revalidatePath('/admin/enquiries')
}

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireOperator()
  const params = await searchParams
  const status: Status = statuses.includes(params.status as Status) ? params.status as Status : 'NEW'
  const [pilot, institutional] = await Promise.all([
    prisma.pilotEnquiry.findMany({ where: { status }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.institutionalEnquiry.findMany({ where: { status }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])
  const enquiries = [
    ...pilot.map(item => ({ ...item, type: 'pilot' as const, category: [item.audience, item.plan].filter(Boolean).join(' · ') })),
    ...institutional.map(item => ({ ...item, type: 'institutional' as const, category: [item.interestArea, item.role].filter(Boolean).join(' · ') })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', color: '#1b2f4a' }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Enquiry review</h1>
      <p style={{ marginTop: 0 }}>Platform operators can review saved pilot and institutional enquiries here. New submissions are not emailed automatically.</p>
      <nav aria-label="Enquiry status" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '24px 0' }}>
        {statuses.map(value => <a key={value} href={`/admin/enquiries?status=${value}`} aria-current={status === value ? 'page' : undefined}>{value.replace('_', ' ')}</a>)}
      </nav>
      <p>{enquiries.length} {status.toLowerCase().replace('_', ' ')} enquiries shown (up to 100 per type).</p>
      {enquiries.length === 0 && <p>No enquiries in this status.</p>}
      <div style={{ display: 'grid', gap: 16 }}>
        {enquiries.map(item => (
          <article key={`${item.type}-${item.id}`} style={{ background: '#fff', border: '1px solid #d6dfdb', borderRadius: 6, padding: 20, overflowWrap: 'anywhere' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 20, margin: 0 }}>{item.orgName}</h2>
              <span>{item.type === 'pilot' ? 'Pilot' : 'Institutional'} · {item.createdAt.toLocaleString('en-GB', { timeZone: 'Europe/London' })}</span>
            </div>
            <p>{item.contactName} · <a href={`mailto:${item.email}`}>{item.email}</a></p>
            <p>{item.category}</p>
            {item.message && <p style={{ whiteSpace: 'pre-wrap' }}>{item.message}</p>}
            <form action={updateEnquiry} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <input type="hidden" name="type" value={item.type} />
              <input type="hidden" name="id" value={item.id} />
              <label htmlFor={`status-${item.type}-${item.id}`}>Status</label>
              <select id={`status-${item.type}-${item.id}`} name="status" defaultValue={item.status}>
                {statuses.map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}
              </select>
              <button type="submit">Save status</button>
            </form>
          </article>
        ))}
      </div>
    </div>
  )
}
