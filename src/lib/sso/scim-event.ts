// Pure interpretation of a WorkOS Directory Sync webhook body. Kept DB-free so the
// event → intent mapping is unit-testable; the route applies the resulting action.
//
// WorkOS shapes (https://workos.com/docs/events/directory-sync):
//   envelope: { id, event, data, created_at }
//   directory user data: { id, emails: [{ primary, value }], first_name, last_name,
//                          state: "active" | "inactive", organization_id, directory_id }
//
// Key subtlety: a soft-deactivation (the common case) arrives as
// `dsync.user.updated` with state "inactive" — NOT a delete. Only a hard delete
// fires `dsync.user.deleted`. So deactivation is driven by state, not just the
// event name.
import { z } from 'zod'

export const scimWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    emails: z
      .array(z.object({ primary: z.boolean().optional(), value: z.string().email() }))
      .default([]),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    state: z.enum(['active', 'inactive']).optional(),
    organization_id: z.string().nullable().optional(),
  }),
})

export type ScimWebhook = z.infer<typeof scimWebhookSchema>

export type ScimIntent =
  | { kind: 'provision'; email: string; name: string; organizationId: string | null; active: boolean }
  | { kind: 'deactivate'; email: string }
  | { kind: 'reactivate'; email: string; name: string; organizationId: string | null }
  | { kind: 'ignore' }

/** Pick the primary email (fallback: first), lowercased. Null if none present. */
export function primaryEmail(emails: ScimWebhook['data']['emails']): string | null {
  const chosen = emails.find((e) => e.primary) ?? emails[0]
  return chosen ? chosen.value.toLowerCase() : null
}

function fullName(data: ScimWebhook['data'], email: string): string {
  return [data.first_name, data.last_name].filter(Boolean).join(' ') || email
}

/** Map a validated WorkOS directory-sync webhook to the action the route should take. */
export function interpretScimWebhook(body: ScimWebhook): ScimIntent {
  const { event, data } = body
  const email = primaryEmail(data.emails)
  if (!email) return { kind: 'ignore' }

  // Hard delete → always deactivate and revoke sessions.
  if (event === 'dsync.user.deleted') {
    return { kind: 'deactivate', email }
  }

  if (event === 'dsync.user.created') {
    // A user can be created already inactive; honour the state.
    return {
      kind: 'provision',
      email,
      name: fullName(data, email),
      organizationId: data.organization_id ?? null,
      active: data.state !== 'inactive',
    }
  }

  if (event === 'dsync.user.updated') {
    // Soft-deactivation is an update to state "inactive"; reactivation flips it back.
    if (data.state === 'inactive') return { kind: 'deactivate', email }
    return { kind: 'reactivate', email, name: fullName(data, email), organizationId: data.organization_id ?? null }
  }

  return { kind: 'ignore' }
}
