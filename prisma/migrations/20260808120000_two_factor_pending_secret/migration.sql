-- A TOTP secret from an in-progress enrolment, held apart from the active one.
--
-- Re-running /api/auth/2fa/setup used to overwrite "twoFactorSecret" directly, so
-- a second enrolment (deliberate or accidental) instantly invalidated the
-- authenticator the user was still holding. The new secret now lands here and is
-- promoted to "twoFactorSecret" only when /api/auth/2fa/enable verifies a code
-- produced by the new device.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twoFactorPendingSecret" TEXT;
