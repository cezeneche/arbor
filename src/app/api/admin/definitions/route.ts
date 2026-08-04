// Layer 2 — publishing the governed dictionary. Platform operator only.
//
// A definition is shared vocabulary: if one tenant could edit it, every other
// tenant's numbers would silently change meaning. Publishing is therefore an
// operator action, and it is append-only — a new version closes the previous one
// at the same instant, so [effectiveFrom, effectiveTo) tiles the timeline without
// gap or overlap and records certified under the old wording keep it forever.
//
// POST body seeds the whole catalogue when `seed: true`, or appends one new
// version of one field otherwise.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { requirePlatformAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { planNewVersion, type StoredFieldDefinition } from '@/lib/definitions/registry'
import { seedDefinitionsAsStored } from '@/lib/definitions/catalogue'
import { domainSchema } from '@/lib/constants'
import type { DataDomain } from '@/lib/constants'

const seedSchema = z.object({
  seed: z.literal(true),
  effectiveFrom: z.string().datetime().optional(),
})

const publishSchema = z.object({
  seed: z.literal(false).optional(),
  fieldName: z.string().min(1),
  domain: domainSchema,
  effectiveFrom: z.string().datetime(),
  label: z.string().min(1),
  definition: z.string().min(20),
  boundary: z.string().min(20),
  canonicalUnit: z.string().nullable().optional(),
  admissibility: z.enum(['COMPULSORY', 'CONDITIONAL', 'OPTIONAL']),
  sourceStandard: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const { session, response } = await requirePlatformAdmin()
  if (!session) return response!
  const actorId = getSessionUser(session).id as string

  const body = await req.json().catch(() => null)

  // ── Seed the initial catalogue ──────────────────────────────────────────────
  const asSeed = seedSchema.safeParse(body)
  if (asSeed.success) {
    const effectiveFrom = asSeed.data.effectiveFrom
      ? new Date(asSeed.data.effectiveFrom)
      : new Date()
    const rows = seedDefinitionsAsStored(effectiveFrom)

    // Idempotent: seed ids are derived from field+domain, so a re-run skips what
    // already exists rather than creating a second version 1.
    const existing = await prisma.fieldDefinition.findMany({
      where: { id: { in: rows.map(r => r.id) } },
      select: { id: true },
    })
    const have = new Set(existing.map(e => e.id))
    const toCreate = rows.filter(r => !have.has(r.id))

    if (toCreate.length > 0) {
      await prisma.fieldDefinition.createMany({
        data: toCreate.map(r => ({ ...r, domain: r.domain as never, createdById: actorId })),
      })
    }

    return NextResponse.json({
      seeded: toCreate.length,
      alreadyPresent: have.size,
      effectiveFrom,
    })
  }

  // ── Append a new version of one field ───────────────────────────────────────
  const parsed = publishSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request.', detail: parsed.error.issues.map(i => i.message) },
      { status: 400 },
    )
  }
  const input = parsed.data
  const effectiveFrom = new Date(input.effectiveFrom)

  const existingRows = await prisma.fieldDefinition.findMany({
    where: { fieldName: input.fieldName, domain: input.domain },
    orderBy: { version: 'asc' },
  })
  const existing: StoredFieldDefinition[] = existingRows.map(r => ({
    ...r,
    domain: r.domain as DataDomain,
    admissibility: r.admissibility as StoredFieldDefinition['admissibility'],
  }))

  let plan
  try {
    plan = planNewVersion(existing, { effectiveFrom })
  } catch (e) {
    // Backdating is refused by the planner — surfaced as a 409, not a 500.
    return NextResponse.json({ error: (e as Error).message }, { status: 409 })
  }

  const created = await prisma.$transaction(async tx => {
    if (plan.closesDefinitionId) {
      await tx.fieldDefinition.update({
        where: { id: plan.closesDefinitionId },
        data: { effectiveTo: plan.closesAt },
      })
    }
    return tx.fieldDefinition.create({
      data: {
        fieldName: input.fieldName,
        domain: input.domain as never,
        version: plan.version,
        effectiveFrom,
        effectiveTo: null,
        label: input.label,
        definition: input.definition,
        boundary: input.boundary,
        canonicalUnit: input.canonicalUnit ?? null,
        admissibility: input.admissibility as never,
        sourceStandard: input.sourceStandard,
        createdById: actorId,
      },
      select: { id: true, version: true },
    })
  })

  return NextResponse.json(
    { id: created.id, version: created.version, supersededDefinitionId: plan.closesDefinitionId },
    { status: 201 },
  )
}
