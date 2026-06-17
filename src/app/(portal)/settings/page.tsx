import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing } from '@/lib/design-system'
import { ProfileEditor } from './ProfileEditor'
import { OrganisationEditor } from './OrganisationEditor'
import { BenchmarkConsentToggle } from './api-keys/BenchmarkConsentToggle'
import { TwoFactorSetup } from './TwoFactorSetup'

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const userId = (session.user as Record<string, unknown>).id as string
  const entityId = (session.user as Record<string, unknown>).entityId as string
  const sessionRole = (session.user as Record<string, unknown>).role as string

  const [user, entity] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, role: true, twoFactorEnabled: true },
    }),
    prisma.entity.findUnique({
      where: { id: entityId },
      select: {
        legalName: true,
        registrationNumber: true,
        country: true,
        sector: true,
        entityType: true,
        allowBenchmarkAggregation: true,
      },
    }),
  ])

  if (!user || !entity) redirect('/login')

  const divider = (
    <div style={{ height: '1px', backgroundColor: colours.border, margin: `${spacing[4]} 0` }} />
  )

  const sectionStyle = {
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: '8px',
    padding: spacing[3],
  }

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: spacing[4] }}>
        <h1
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.medium,
            color: colours.textPrimary,
            margin: 0,
            letterSpacing: typography.tracking.tight,
          }}
        >
          Settings
        </h1>
        <p
          style={{
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.light,
            color: colours.textSecondary,
            margin: `${spacing[1]} 0 0`,
          }}
        >
          Manage your account, organisation profile, and data preferences.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[3] }}>
        {/* Account */}
        <div style={sectionStyle}>
          <ProfileEditor
            name={user.name}
            email={user.email}
            role={user.role}
          />
        </div>

        {/* Organisation */}
        <div style={sectionStyle}>
          <OrganisationEditor
            legalName={entity.legalName}
            registrationNumber={entity.registrationNumber ?? null}
            country={entity.country}
            sector={entity.sector}
            entityType={entity.entityType}
            isAdmin={sessionRole === 'ADMIN'}
          />
        </div>

        {/* Data preferences */}
        <div style={sectionStyle}>
          <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: `0 0 ${spacing[1]}` }}>
            Data preferences
          </p>
          <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `0 0 ${spacing[2]}` }}>
            Control how your data is used beyond your own account.
          </p>
          <BenchmarkConsentToggle initialValue={entity.allowBenchmarkAggregation} />
          {divider}
          <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: 0, lineHeight: '1.6' }}>
            To request account closure or permanent data deletion, contact{' '}
            <a href="mailto:support@arbor.uk" style={{ color: colours.textSecondary, textDecoration: 'underline' }}>support@arbor.uk</a>.
            Your certified records will be retained for audit chain integrity until the request is processed.
          </p>
        </div>

        {/* Security */}
        <div style={sectionStyle}>
          <TwoFactorSetup
            enabled={user.twoFactorEnabled}
            isAdmin={sessionRole === 'ADMIN'}
          />
        </div>

        {/* Integrations */}
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>
                Integrations &amp; API keys
              </p>
              <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `4px 0 0` }}>
                Connect your ERP or accounting system to push data into arbor automatically.
              </p>
            </div>
            <Link
              href="/settings/api-keys"
              style={{
                padding: '6px 14px',
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.medium,
                color: colours.navy,
                backgroundColor: 'transparent',
                border: `1px solid ${colours.border}`,
                borderRadius: '4px',
                textDecoration: 'none',
                letterSpacing: typography.tracking.wide,
                whiteSpace: 'nowrap' as const,
              }}
            >
              Manage
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
