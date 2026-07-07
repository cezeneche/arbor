import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { authenticateApiKey } from '@/lib/api-key-auth'
import { enforceBuyerApiLimit } from '@/lib/rate-limit-guard'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { convertFromSI, isSupportedUnit } from '@/lib/layer3/unit-conversion'
import type { SupportedUnit } from '@/lib/layer3/unit-conversion'

// Layer 3  -  output-time unit conversion.
// Converts a stored SI value to the requested unit. Never modifies stored data.
// PRD Section 14  -  conversion transparency: response always includes original + converted + factor.

const bodySchema = z.object({
  recordId: z.string().min(1),
  targetUnit: z.string().min(1),
})

export async function POST(req: NextRequest) {
  // Support both session auth (portal) and API key auth (integration layer)
  let entityId: string | null = null

  const apiKeyAuth = await authenticateApiKey(req.headers.get('authorization'))
  if (apiKeyAuth.authorized) {
    entityId = apiKeyAuth.entityId!
  } else {
    const { session } = await requireAuth()
    if (session?.user) {
      entityId = getSessionUser(session).entityId as string
    }
  }

  if (!entityId) return err('Unauthorized', 'UNAUTHORIZED', 401)

  const limited = await enforceBuyerApiLimit(entityId)
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const { recordId, targetUnit } = parsed.data

  if (!isSupportedUnit(targetUnit)) {
    return err(
      `Unsupported unit '${targetUnit}'. See /api/records/convert/units for supported values.`,
      'UNSUPPORTED_UNIT',
      400,
    )
  }

  const record = await prisma.dataRecord.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      entityId: true,
      domain: true,
      fieldName: true,
      value: true,
      unit: true,
      originalValue: true,
      originalUnit: true,
      trustTier: true,
      periodStart: true,
      periodEnd: true,
      confidenceScore: true,
      documentId: true,
    },
  })

  if (!record) return err('Record not found', 'NOT_FOUND', 404)

  // Check the requesting entity owns this record or has an active access grant for it
  if (record.entityId !== entityId) {
    const grant = await prisma.dataAccessGrant.findFirst({
      where: {
        grantorEntityId: record.entityId,
        granteeEntityId: entityId,
        isActive: true,
        revokedAt: null,
        OR: [{ domain: null }, { domain: record.domain }],
      },
    })
    if (!grant) return err('Access denied', 'FORBIDDEN', 403)

    // Verify record falls within the grant's period scope
    const periodOk =
      (!grant.periodStart || record.periodEnd >= grant.periodStart) &&
      (!grant.periodEnd || record.periodStart <= grant.periodEnd)
    if (!periodOk) return err('Access denied : record outside grant period', 'FORBIDDEN', 403)
  }

  let conversion
  try {
    conversion = convertFromSI(record.value, record.unit as never, targetUnit as SupportedUnit)
  } catch (e) {
    return err(
      e instanceof Error ? e.message : 'Conversion failed',
      'INCOMPATIBLE_UNITS',
      400,
    )
  }

  return ok({
    recordId: record.id,
    domain: record.domain,
    fieldName: record.fieldName,
    trustTier: record.trustTier,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    confidenceScore: record.confidenceScore,
    documentId: record.documentId,
    stored: {
      value: record.value,
      unit: record.unit,
    },
    original: {
      value: record.originalValue,
      unit: record.originalUnit,
    },
    converted: {
      value: conversion.convertedValue,
      unit: conversion.convertedUnit,
      conversionFactor: conversion.conversionFactor,
    },
  })
}
