import { scimWebhookSchema, interpretScimWebhook, emailFrom } from '@/lib/sso/scim-event'

function body(event: string, data: Record<string, unknown>) {
  return scimWebhookSchema.parse({ event, data })
}

describe('emailFrom', () => {
  it('prefers the top-level email (the live webhook shape), lowercased', () => {
    expect(emailFrom(body('x', { email: 'Scim.Test@Example.com', emails: [] }).data)).toBe('scim.test@example.com')
  })
  it('falls back to the primary of emails[] when there is no top-level email', () => {
    const data = body('x', { emails: [{ value: 'alt@x.com' }, { primary: true, value: 'P@X.com' }] }).data
    expect(emailFrom(data)).toBe('p@x.com')
  })
  it('returns null when no usable email is present', () => {
    expect(emailFrom(body('x', { emails: [] }).data)).toBeNull()
  })
})

describe('interpretScimWebhook — real WorkOS payload shape', () => {
  // Mirrors an actual dsync.user.created delivery: top-level email, string name,
  // empty emails[], state active.
  const created = body('dsync.user.created', {
    id: 'directory_user_01ABC',
    object: 'directory_user',
    email: 'scim.test@example.com',
    emails: [],
    name: 'Scim Test',
    state: 'active',
    organization_id: 'org_1',
    idp_id: 'test-001',
  })

  it('provisions from the top-level email and string name', () => {
    expect(interpretScimWebhook(created)).toEqual({
      kind: 'provision',
      email: 'scim.test@example.com',
      name: 'Scim Test',
      organizationId: 'org_1',
      active: true,
    })
  })

  it('provisions inactive when created with state inactive', () => {
    const b = body('dsync.user.created', { email: 'a@b.com', emails: [], state: 'inactive', organization_id: 'org_1' })
    expect(interpretScimWebhook(b)).toMatchObject({ kind: 'provision', active: false })
  })

  it('deactivates on a soft-delete (updated → inactive), not just on delete', () => {
    const b = body('dsync.user.updated', { email: 'a@b.com', emails: [], state: 'inactive' })
    expect(interpretScimWebhook(b)).toEqual({ kind: 'deactivate', email: 'a@b.com' })
  })

  it('reactivates on updated → active', () => {
    const b = body('dsync.user.updated', { email: 'a@b.com', emails: [], state: 'active', organization_id: 'org_1' })
    expect(interpretScimWebhook(b)).toMatchObject({ kind: 'reactivate', email: 'a@b.com', organizationId: 'org_1' })
  })

  it('deactivates on a hard delete', () => {
    const b = body('dsync.user.deleted', { email: 'a@b.com', emails: [] })
    expect(interpretScimWebhook(b)).toEqual({ kind: 'deactivate', email: 'a@b.com' })
  })

  it('ignores unrelated events and payloads with no email', () => {
    expect(interpretScimWebhook(body('dsync.group.updated', { email: 'a@b.com', emails: [] }))).toEqual({ kind: 'ignore' })
    expect(interpretScimWebhook(body('dsync.user.created', { emails: [] }))).toEqual({ kind: 'ignore' })
  })

  it('composes a name from first/last when there is no name string, else the email', () => {
    const withParts = body('dsync.user.created', { email: 'a@b.com', emails: [], first_name: 'Ada', last_name: 'Lovelace', organization_id: 'org_1' })
    expect(interpretScimWebhook(withParts)).toMatchObject({ name: 'Ada Lovelace' })
    const noName = body('dsync.user.created', { email: 'a@b.com', emails: [], organization_id: 'org_1' })
    expect(interpretScimWebhook(noName)).toMatchObject({ name: 'a@b.com' })
  })
})
