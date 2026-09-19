// Creating an organisation and its first user, as one unit.
//
// Two separate writes left an organisation with no user whenever the second
// failed — including when two signups raced for one email, since both passed
// the availability check before either wrote. The unique constraint on email
// is the real check; a violation of it rolls the organisation back with it.
import { randomBytes } from 'crypto'
import type { EntityType, PrismaClient } from '@prisma/client'

export class EmailTakenError extends Error {
  constructor() {
    super('An account with this email already exists.')
    this.name = 'EmailTakenError'
  }
}

export interface NewAccount {
  companyName: string
  sector: string
  country: string
  entityType: EntityType
  name: string
  /** Already lower-cased. */
  email: string
  passwordHash: string
}

function isEmailUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } }
  if (err?.code !== 'P2002') return false
  const target = err.meta?.target
  return Array.isArray(target) ? target.includes('email') : String(target ?? '').includes('email')
}

export async function createAccount(
  db: Pick<PrismaClient, '$transaction'>,
  input: NewAccount,
): Promise<{ entityId: string; userId: string }> {
  try {
    return await db.$transaction(async tx => {
      const entity = await tx.entity.create({
        data: {
          legalName: input.companyName,
          sector: input.sector,
          country: input.country,
          entityType: input.entityType,
          // email-to-upload token: upload-<token>@arbor.io
          uploadEmailToken: randomBytes(8).toString('hex'),
        },
      })
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash: input.passwordHash,
          entityId: entity.id,
          role: 'ADMIN',
        },
      })
      return { entityId: entity.id, userId: user.id }
    })
  } catch (e) {
    if (isEmailUniqueViolation(e)) throw new EmailTakenError()
    throw e
  }
}
