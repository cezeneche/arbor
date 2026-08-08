// Pure decision logic for SSO auto-provisioning. No DB, no network, no AI —
// the WorkOS callback wires this to Prisma.
//
// The IdP proves "this person controls this email in this organisation". It does
// NOT prove they may act inside whatever Arbor tenant already holds that email,
// and it does not prove they are still employed. Both of those are Arbor's call,
// so they are decided here rather than inferred from the profile.

export type SsoProvisionDecision =
  | { action: 'SIGN_IN'; userId: string }
  | { action: 'CREATE' }
  | { action: 'REJECT'; reason: SsoRejectReason }

export type SsoRejectReason = 'account_disabled' | 'email_other_org'

export interface ExistingSsoUser {
  id: string
  entityId: string | null
  isActive: boolean
}

export function decideSsoProvisioning(
  existing: ExistingSsoUser | null,
  entityId: string,
): SsoProvisionDecision {
  if (!existing) return { action: 'CREATE' }

  // Tenant binding. An email already attached to another entity — or to no entity
  // at all, as platform roles are — must never be adopted into this organisation
  // just because its IdP asserted the address.
  if (existing.entityId !== entityId) {
    return { action: 'REJECT', reason: 'email_other_org' }
  }

  // Deprovisioning is deliberate. Signing in through the IdP is not a request to
  // undo it: reactivation is an administrative act, so the sign-in fails instead.
  if (!existing.isActive) {
    return { action: 'REJECT', reason: 'account_disabled' }
  }

  return { action: 'SIGN_IN', userId: existing.id }
}
