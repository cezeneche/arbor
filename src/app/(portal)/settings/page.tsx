import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { colours, typography, spacing, textStyles } from '@/lib/design-system'
import { ProfileEditor } from './ProfileEditor'
import { OrganisationEditor } from './OrganisationEditor'
import { BenchmarkConsentToggle } from './api-keys/BenchmarkConsentToggle'
import { TwoFactorSetup } from './TwoFactorSetup'

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const userId = getSessionUser(session).id
  const entityId = getSessionUser(session).entityId as string
  const sessionRole = getSessionUser(session).role

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
        <h1 style={textStyles.pageTitle}>Settings</h1>
        <p style={{ ...textStyles.pageSubtitle, marginTop: spacing[1] }}>
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
          <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[1] }}>
            Data preferences
          </p>
          <p style={{ ...textStyles.sectionSubtitle, marginBottom: spacing[2] }}>
            Control how your data is used beyond your own account.
          </p>
          <BenchmarkConsentToggle initialValue={entity.allowBenchmarkAggregation} />
          {divider}
          <p style={{ ...textStyles.caption, color: colours.textTertiary, lineHeight: '1.6' }}>
            To request account closure or permanent data deletion, contact{' '}
            <a href="mailto:support@arbor.uk" style={{ color: colours.textSecondary, textDecoration: 'underline' }}>support@arbor.uk</a>.
            Your certified records will be retained for audit chain integrity until the request is processed.
          </p>
        </div>

        {/* Reports & logs - reads-not-fills tools, kept off the primary nav */}
        <div style={sectionStyle}>
          <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[1] }}>
            Logs &amp; access
          </p>
          <p style={{ ...textStyles.sectionSubtitle, marginBottom: spacing[2] }}>
            Review the history of every change to your data. Data quality, trends and benchmarks now live in Records.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { href: '/activity', label: entity.entityType === 'BUYER' ? 'Audit log' : 'Activity', desc: 'A time-ordered log of every action taken on your data.' },
              ...(entity.entityType === 'BUYER'
                ? [{ href: '/access', label: 'Access control', desc: 'Manage which buyers can see which of your records.' }]
                : []),
            ].map((row) => (
              <div key={row.href} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: spacing[2] }}>
                <div>
                  <p style={textStyles.rowTitle}>{row.label}</p>
                  <p style={{ ...textStyles.caption, marginTop: '2px' }}>{row.desc}</p>
                </div>
                <Link
                  href={row.href}
                  style={{ padding: '6px 14px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.navy, border: `1px solid ${colours.border}`, borderRadius: '4px', textDecoration: 'none', letterSpacing: typography.tracking.wide, whiteSpace: 'nowrap' as const }}
                >
                  Open
                </Link>
              </div>
            ))}
          </div>
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
              <p style={textStyles.sectionTitle}>
                Integrations &amp; API keys
              </p>
              <p style={{ ...textStyles.sectionSubtitle, marginTop: '4px' }}>
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

        {/* Admin-only: connectors, webhooks, SSO */}
        {sessionRole === 'ADMIN' && (
          <div style={sectionStyle}>
            <p style={{ ...textStyles.sectionTitle, marginBottom: spacing[2] }}>
              Administration
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { href: '/settings/integrations', label: 'ERP & customs integrations', desc: 'Connect CDS, SAP, or NetSuite to pull data automatically.' },
                { href: '/settings/webhooks', label: 'Webhooks', desc: 'Receive signed callbacks on certified records and access changes.' },
                { href: '/settings/sso', label: 'Single sign-on', desc: 'Connect your identity provider via WorkOS.' },
              ].map((row) => (
                <div key={row.href} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: spacing[2] }}>
                  <div>
                    <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>{row.label}</p>
                    <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textSecondary, margin: '2px 0 0' }}>{row.desc}</p>
                  </div>
                  <Link
                    href={row.href}
                    style={{ padding: '6px 14px', fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.navy, border: `1px solid ${colours.border}`, borderRadius: '4px', textDecoration: 'none', letterSpacing: typography.tracking.wide, whiteSpace: 'nowrap' as const }}
                  >
                    Manage
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
