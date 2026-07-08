// Pure interpretation of a WorkOS Directory Sync webhook body. Kept DB-free so the
// event → intent mapping is unit-testable; the route applies the resulting action.
//
// The live webhook `data` for a directory user looks like:
//   { id, object: "directory_user", email: "a@b.com", emails: [...], name: "Ada L",
//     first_name?, last_name?, state: "active" | "inactive", organization_id, idp_id }
// Note the shape is loose in practice: the primary address may arrive as the
// top-level `email` with `emails` empty, and the display name as a single `name`
// string rather than first/last — so we read from either.
//
// Key subtlety: a soft-deactivation (the common case) arrives as
// `dsync.user.updated` with state "inactive" — NOT a delete. Only a hard delete
// fires `dsync.user.deleted`. So deactivation is driven by state, not event name.
import { z } from 'zod'

export const scimWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    email: z.string().nullable().optional(),
    emails: z.array(z.object({ primary: z.boolean().optional(), value: z.string() })).default([]),
    name: z.string().nullable().optional(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    state: z.enum(['active', 'inactive']).optional(),
    organization_id: z.string().nullable().optional(),
  }),
})

export type ScimWebhook = z.infer<typeof scimWebhookSchema>
export type ScimData = ScimWebhook['data']

export type ScimIntent =
  | { kind: 'provision'; email: string; name: string; organizationId: string | null; active: boolean }
  | { kind: 'deactivate'; email: string }
  | { kind: 'reactivate'; email: string; name: string; organizationId: string | null }
  | { kind: 'ignore' }

/** The user's primary email: the top-level `email`, else the primary (or first) of `emails`. Lowercased. */
export function emailFrom(data: ScimData): string | null {
  if (data.email && data.email.includes('@')) return data.email.toLowerCase()
  const chosen = data.emails.find((e) => e.primary) ?? data.emails[0]
  return chosen && chosen.value.includes('@') ? chosen.value.toLowerCase() : null
}

/** Display name: the `name` string, else first+last, else the email as a fallback. */
export function nameFrom(data: ScimData, email: string): string {
  if (data.name && data.name.trim()) return data.name.trim()
  const composed = [data.first_name, data.last_name].filter(Boolean).join(' ')
  return composed || email
}

/** Map a validated WorkOS directory-sync webhook to the action the route should take. */
export function interpretScimWebhook(body: ScimWebhook): ScimIntent {
  const { event, data } = body
  const email = emailFrom(data)
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
      name: nameFrom(data, email),
      organizationId: data.organization_id ?? null,
      active: data.state !== 'inactive',
    }
  }

  if (event === 'dsync.user.updated') {
    // Soft-deactivation is an update to state "inactive"; reactivation flips it back.
    if (data.state === 'inactive') return { kind: 'deactivate', email }
    return { kind: 'reactivate', email, name: nameFrom(data, email), organizationId: data.organization_id ?? null }
  }

  return { kind: 'ignore' }
}
