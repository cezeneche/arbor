import { colours, typography, spacing } from '@/lib/design-system'
import { SupplierForm } from '@/components/SupplierForm'
import {
  getSupplierFormContext,
  SupplierTokenInvalidError,
} from '@/lib/nucleos/supplier-form-client'

// The public supplier form, now hosted by Arbor.
//
// Outside the (portal) route group on purpose: there is no session and no login.
// The supplier is not an Arbor user, has no account, and will never have one.
// The URL token is the credential and Nucleos validates it.
//
// Everything they need to answer has to be on this page. A supplier who cannot
// tell which shipment is being asked about will not answer.

export const dynamic = 'force-dynamic'

export default async function SupplierFormPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  let context = null
  let message: string | null = null
  try {
    context = await getSupplierFormContext(token)
  } catch (err) {
    message =
      err instanceof SupplierTokenInvalidError
        ? err.message
        : 'This form cannot be loaded at the moment. Please try again in a few minutes.'
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: colours.background,
        padding: spacing[5],
      }}
    >
      <div style={{ maxWidth: '520px', margin: '0 auto' }}>
        <div
          style={{
            fontSize: typography.sizes.base,
            fontWeight: typography.weights.medium,
            color: colours.navy,
            marginBottom: spacing[5],
          }}
        >
          arbor
        </div>

        {message ? (
          <p
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.light,
              color: colours.textSecondary,
            }}
          >
            {message}
          </p>
        ) : context ? (
          <>
            <h1
              style={{
                fontSize: typography.sizes.lg,
                fontWeight: typography.weights.medium,
                color: colours.textPrimary,
                margin: 0,
              }}
            >
              {context.importer_name ?? 'A customer'} needs one figure from you
            </h1>
            <p
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textSecondary,
                margin: `${spacing[2]} 0 ${spacing[4]}`,
              }}
            >
              It is about the goods below, and it should take a couple of minutes.
              You do not need an account.
            </p>

            <div
              style={{
                border: `1px solid ${colours.border}`,
                borderRadius: '6px',
                padding: spacing[3],
                marginBottom: spacing[5],
                backgroundColor: colours.surface,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.light,
                color: colours.textPrimary,
              }}
            >
              <div>Commodity code {context.cn_code}</div>
              {context.origin_country && <div>Made in {context.origin_country}</div>}
              <div>For the {context.reporting_year} reporting year</div>
            </div>

            <SupplierForm token={token} context={context} />
          </>
        ) : null}
      </div>
    </main>
  )
}
