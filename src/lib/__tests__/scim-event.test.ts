import { scimWebhookSchema, interpretScimWebhook, primaryEmail } from '@/lib/sso/scim-event'

function body(event: string, data: Record<string, unknown>) {
  return scimWebhookSchema.parse({ event, data })
}

const emails = [
  { primary: false, value: 'alt@Example.com' },
  { primary: true, value: 'Primary@Example.com' },
]

describe('primaryEmail', () => {
  it('prefers the primary address, lowercased', () => {
    expect(primaryEmail(emails)).toBe('primary@example.com')
  })
  it('falls back to the first when none is marked primary', () => {
    expect(primaryEmail([{ value: 'First@Example.com' }])).toBe('first@example.com')
  })
  it('returns null when there are no emails', () => {
    expect(primaryEmail([])).toBeNull()
  })
})

describe('interpretScimWebhook', () => {
  it('provisions on dsync.user.created', () => {
    const intent = interpretScimWebhook(
      body('dsync.user.created', { emails, first_name: 'Ada', last_name: 'Lovelace', state: 'active', organization_id: 'org_1' }),
    )
    expect(intent).toEqual({
      kind: 'provision',
      email: 'primary@example.com',
      name: 'Ada Lovelace',
      organizationId: 'org_1',
      active: true,
    })
  })

  it('provisions inactive when created with state inactive', () => {
    const intent = interpretScimWebhook(body('dsync.user.created', { emails, state: 'inactive', organization_id: 'org_1' }))
    expect(intent).toMatchObject({ kind: 'provision', active: false })
  })

  it('deactivates on a soft-delete (updated → inactive), not just on delete', () => {
    const intent = interpretScimWebhook(body('dsync.user.updated', { emails, state: 'inactive' }))
    expect(intent).toEqual({ kind: 'deactivate', email: 'primary@example.com' })
  })

  it('reactivates on updated → active', () => {
    const intent = interpretScimWebhook(body('dsync.user.updated', { emails, state: 'active', organization_id: 'org_1' }))
    expect(intent).toMatchObject({ kind: 'reactivate', email: 'primary@example.com', organizationId: 'org_1' })
  })

  it('deactivates on a hard delete', () => {
    const intent = interpretScimWebhook(body('dsync.user.deleted', { emails, state: 'inactive' }))
    expect(intent).toEqual({ kind: 'deactivate', email: 'primary@example.com' })
  })

  it('ignores unrelated events and payloads with no email', () => {
    expect(interpretScimWebhook(body('dsync.group.updated', { emails }))).toEqual({ kind: 'ignore' })
    expect(interpretScimWebhook(body('dsync.user.created', { emails: [] }))).toEqual({ kind: 'ignore' })
  })

  it('falls back to email as the name when no name is provided', () => {
    const intent = interpretScimWebhook(body('dsync.user.created', { emails, organization_id: 'org_1' }))
    expect(intent).toMatchObject({ name: 'primary@example.com' })
  })
})
