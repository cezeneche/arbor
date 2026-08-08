import { decideSsoProvisioning } from '../provisioning'

describe('decideSsoProvisioning', () => {
  const ENTITY = 'entity-a'

  it('creates a user when the email is unknown', () => {
    expect(decideSsoProvisioning(null, ENTITY)).toEqual({ action: 'CREATE' })
  })

  it('signs in an active user already bound to this entity', () => {
    expect(
      decideSsoProvisioning({ id: 'u1', entityId: ENTITY, isActive: true }, ENTITY),
    ).toEqual({ action: 'SIGN_IN', userId: 'u1' })
  })

  // The WorkOS profile proves control of the email, not membership of the tenant
  // that already holds it. Adopting it would hand an attacker who owns the address
  // in their own IdP a session inside somebody else's organisation.
  it('rejects an email that belongs to a different entity', () => {
    expect(
      decideSsoProvisioning({ id: 'u1', entityId: 'entity-b', isActive: true }, ENTITY),
    ).toEqual({ action: 'REJECT', reason: 'email_other_org' })
  })

  it('rejects an email attached to no entity (platform roles are not SSO-provisionable)', () => {
    expect(
      decideSsoProvisioning({ id: 'u1', entityId: null, isActive: true }, ENTITY),
    ).toEqual({ action: 'REJECT', reason: 'email_other_org' })
  })

  // SCIM deprovisioning must not be reversible by simply signing in again.
  it('rejects a deprovisioned user instead of reactivating them', () => {
    expect(
      decideSsoProvisioning({ id: 'u1', entityId: ENTITY, isActive: false }, ENTITY),
    ).toEqual({ action: 'REJECT', reason: 'account_disabled' })
  })

  it('checks tenant binding before account state', () => {
    expect(
      decideSsoProvisioning({ id: 'u1', entityId: 'entity-b', isActive: false }, ENTITY),
    ).toEqual({ action: 'REJECT', reason: 'email_other_org' })
  })
})
