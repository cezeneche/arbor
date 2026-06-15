import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth, requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'

const createSchema = z.object({
  supplierEntityId: z.string().cuid(),
  domain: z.enum(['ENERGY', 'MATERIALS', 'PRODUCTION', 'LOGISTICS', 'EMISSIONS', 'AGRICULTURE', 'WASTE_AND_WATER', 'COMPLIANCE']),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  requiredFields: z.array(z.string()).min(1),
  deadline: z.string().datetime().optional(),
  notes: z.string().optional(),
})

export async function GET() {
  const { session, response } = await requireAuth()
  if (!session) return response!

  const entityId = (session.user as Record<string, unknown>).entityId as string

  const requests = await prisma.dataRequest.findMany({
    where: {
      OR: [{ buyerEntityId: entityId }, { supplierEntityId: entityId }],
    },
    include: {
      buyerEntity: { select: { legalName: true } },
      supplierEntity: { select: { legalName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return ok(requests)
}

export async function POST(req: NextRequest) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const entityId = (session.user as Record<string, unknown>).entityId as string

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return err('Invalid request body', 'VALIDATION_ERROR', 400)

  const supplier = await prisma.entity.findUnique({
    where: { id: parsed.data.supplierEntityId },
    select: { legalName: true },
  })
  if (!supplier) return err('Supplier entity not found', 'NOT_FOUND', 404)

  const buyer = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { legalName: true },
  })

  const dataRequest = await prisma.dataRequest.create({
    data: {
      buyerEntityId: entityId,
      supplierEntityId: parsed.data.supplierEntityId,
      requestedById: session.user!.id!,
      domain: parsed.data.domain,
      periodStart: new Date(parsed.data.periodStart),
      periodEnd: new Date(parsed.data.periodEnd),
      requiredFields: parsed.data.requiredFields,
      deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : undefined,
      notes: parsed.data.notes,
    },
  })

  await sendNotification({
    entityId: parsed.data.supplierEntityId,
    type: 'DATA_REQUEST_RECEIVED',
    payload: {
      requestId: dataRequest.id,
      buyerName: buyer?.legalName ?? 'A buyer',
      domain: parsed.data.domain,
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd,
    },
  })

  return ok({ requestId: dataRequest.id }, 201)
}
