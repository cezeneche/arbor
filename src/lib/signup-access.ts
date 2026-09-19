// Who may create an account. Arbor runs as an invite-only pilot: plans are
// agreed directly and there is no self-service billing, so an open signup
// form offered something that did not exist.
//
//   SIGNUP_OPEN=true           anyone may sign up
//   PILOT_INVITE_CODES=a,b,c   signup needs one of these codes
//   neither                    signup is closed
export type SignupAccess = { allowed: true } | { allowed: false; reason: 'closed' | 'invite_required' }

const normalise = (s: string) => s.trim().toLowerCase()

export function checkSignupAccess(
  inviteCode: string | undefined,
  env: Record<string, string | undefined>,
): SignupAccess {
  if (env.SIGNUP_OPEN === 'true') return { allowed: true }
  const codes = (env.PILOT_INVITE_CODES ?? '').split(',').map(normalise).filter(Boolean)
  if (codes.length === 0) return { allowed: false, reason: 'closed' }
  if (inviteCode && codes.includes(normalise(inviteCode))) return { allowed: true }
  return { allowed: false, reason: 'invite_required' }
}
