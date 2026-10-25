import type { Metadata } from 'next'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requirePageSession } from '@/lib/page-auth'
import { getSessionUser } from '@/lib/session'
import { SectionViewNav } from '@/components/SectionViewNav'
import { colours, controls, spacing, textStyles, typography } from '@/lib/design-system'

export const metadata: Metadata = { title: 'Enquiries | Arbor' }

const statuses = ['NEW', 'IN_PROGRESS', 'CLOSED'] as const
type Status = (typeof statuses)[number]
const statusLabels: Record<Status, string> = { NEW: 'New', IN_PROGRESS: 'In progress', CLOSED: 'Closed' }

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
  if (
    (type !== 'pilot' && type !== 'institutional') ||
    typeof id !== 'string' ||
    !id ||
    !statuses.includes(status as Status)
  ) {
    throw new Error('Invalid enquiry update')
  }
  if (type === 'pilot') {
    await prisma.pilotEnquiry.update({ where: { id }, data: { status: status as Status } })
  } else {
    await prisma.institutionalEnquiry.update({ where: { id }, data: { status: status as Status } })
  }
  revalidatePath('/admin/enquiries')
}

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await requireOperator()
  const params = await searchParams
  const status: Status = statuses.includes(params.status as Status) ? (params.status as Status) : 'NEW'
  const [pilot, institutional] = await Promise.all([
    prisma.pilotEnquiry.findMany({ where: { status }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.institutionalEnquiry.findMany({ where: { status }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])
  const enquiries = [
    ...pilot.map(item => ({
      ...item,
      type: 'pilot' as const,
      category: [item.audience, item.plan].filter(Boolean).join(' · '),
    })),
    ...institutional.map(item => ({
      ...item,
      type: 'institutional' as const,
      category: [item.interestArea, item.role].filter(Boolean).join(' · '),
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return (
    <div style={{ width: '100%', color: colours.textPrimary }}>
      <div style={{ marginBottom: spacing[5] }}>
        <h1 style={textStyles.pageTitle}>Enquiries</h1>
        <p style={{ ...textStyles.sectionSubtitle, margin: `${spacing[1]} 0 0` }}>
          Pilot and institutional enquiries to follow up.
        </p>
      </div>
      <SectionViewNav
        label="Enquiry status"
        active={status}
        items={statuses.map(value => ({
          id: value,
          label: statusLabels[value],
          href: `/admin/enquiries?status=${value}`,
        }))}
      />
      {enquiries.length === 0 && (
        <p style={{ ...textStyles.sectionSubtitle }}>No enquiries in this status.</p>
      )}
      <div style={{ display: 'grid', gap: spacing[2] }}>
        {enquiries.map(item => (
          <article
            key={`${item.type}-${item.id}`}
            style={{
              background: colours.surface,
              border: `1px solid ${colours.border}`,
              borderRadius: '6px',
              padding: spacing[3],
              overflowWrap: 'anywhere',
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              lineHeight: typography.lineHeight.body,
              display: 'flex',
              flexDirection: 'column',
              gap: spacing[2],
            }}
          >
            <div
              style={{ display: 'flex', justifyContent: 'space-between', gap: spacing[2], flexWrap: 'wrap' }}
            >
              <h2 style={textStyles.rowTitle}>{item.orgName}</h2>
              <span style={{ ...textStyles.caption, color: colours.textTertiary }}>
                {item.type === 'pilot' ? 'Pilot' : 'Institutional'} ·{' '}
                {item.createdAt.toLocaleString('en-GB', { timeZone: 'Europe/London' })}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
              <p style={textStyles.value}>
                {item.contactName} ·{' '}
                <a href={`mailto:${item.email}`} style={{ color: colours.navy }}>
                  {item.email}
                </a>
              </p>
              {item.category && <p style={textStyles.caption}>{item.category}</p>}
            </div>
            {item.message && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{item.message}</p>}
            <form
              action={updateEnquiry}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: spacing[2],
                flexWrap: 'wrap',
                borderTop: `1px solid ${colours.border}`,
                paddingTop: spacing[2],
              }}
            >
              <input type="hidden" name="type" value={item.type} />
              <input type="hidden" name="id" value={item.id} />
              <label htmlFor={`status-${item.type}-${item.id}`} style={textStyles.rowTitle}>
                Status
              </label>
              <select
                id={`status-${item.type}-${item.id}`}
                name="status"
                defaultValue={item.status}
                style={controls.input}
              >
                {statuses.map(value => (
                  <option key={value} value={value}>
                    {statusLabels[value]}
                  </option>
                ))}
              </select>
              <button type="submit" style={controls.primaryButton}>
                Save status
              </button>
            </form>
          </article>
        ))}
      </div>
    </div>
  )
}
