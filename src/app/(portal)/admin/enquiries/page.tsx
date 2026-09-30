import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requirePageSession } from '@/lib/page-auth'
import { getSessionUser } from '@/lib/session'
import { colours, spacing, textStyles, typography } from '@/lib/design-system'

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
    <div style={{ maxWidth: 1000, margin: '0 auto', color: colours.textPrimary }}>
      <h1 style={{ ...textStyles.pageTitle, marginBottom: spacing[1] }}>Enquiry review</h1>
      <p style={{ ...textStyles.sectionSubtitle, marginTop: 0 }}>Platform operators can review saved pilot and institutional enquiries here. New submissions are not emailed automatically.</p>
      <nav aria-label="Enquiry status" style={{ display: 'flex', gap: spacing[2], flexWrap: 'wrap', margin: `${spacing[3]} 0`, fontSize: typography.sizes.sm }}>
        {statuses.map(value => <a key={value} href={`/admin/enquiries?status=${value}`} aria-current={status === value ? 'page' : undefined}>{value.replace('_', ' ')}</a>)}
      </nav>
      <p>{enquiries.length} {status.toLowerCase().replace('_', ' ')} enquiries shown (up to 100 per type).</p>
      {enquiries.length === 0 && <p>No enquiries in this status.</p>}
      <div style={{ display: 'grid', gap: spacing[2] }}>
        {enquiries.map(item => (
          <article key={`${item.type}-${item.id}`} style={{ background: colours.surface, border: `1px solid ${colours.border}`, borderRadius: '6px', padding: spacing[3], overflowWrap: 'anywhere', fontSize: typography.sizes.sm, fontWeight: typography.weights.light }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing[2], flexWrap: 'wrap' }}>
              <h2 style={{ ...textStyles.sectionTitle, margin: 0 }}>{item.orgName}</h2>
              <span style={{ ...textStyles.caption, color: colours.textTertiary }}>{item.type === 'pilot' ? 'Pilot' : 'Institutional'} · {item.createdAt.toLocaleString('en-GB', { timeZone: 'Europe/London' })}</span>
            </div>
            <p>{item.contactName} · <a href={`mailto:${item.email}`}>{item.email}</a></p>
            <p>{item.category}</p>
            {item.message && <p style={{ whiteSpace: 'pre-wrap' }}>{item.message}</p>}
            <form action={updateEnquiry} style={{ display: 'flex', alignItems: 'center', gap: spacing[1], flexWrap: 'wrap' }}>
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
