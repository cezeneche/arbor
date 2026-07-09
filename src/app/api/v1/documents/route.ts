import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateApiKeyRequest } from '@/lib/api-key-auth'
import { err } from '@/lib/api-helpers'
import { inngest } from '@/inngest/client'
import { documentTypeSchema } from '@/lib/constants'

const bodySchema = z.object({
  documentType: documentTypeSchema,
  blobUrl: z.string().min(1),
  fileName: z.string().min(1),
  reportingPeriodEnd: z.string().datetime().optional(),
})

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKeyRequest(req)
  if (!auth.authorized) {
    return err(auth.reason ?? 'Unauthorized', 'UNAUTHORIZED', 401)
  }
  if (auth.scope !== 'READ_WRITE') {
    return err('This API key is read-only', 'FORBIDDEN', 403)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return err('Invalid JSON body', 'INVALID_BODY', 400)
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? 'Invalid request body', 'VALIDATION_ERROR', 400)
  }

  const { documentType, blobUrl, fileName, reportingPeriodEnd } = parsed.data

  // blobUrl must be a storage path owned by the authenticated entity.
  // Stored paths take the form "{entityId}/{timestamp}.{ext}".
  if (!blobUrl.startsWith(`${auth.entityId!}/`)) {
    return err('blobUrl does not belong to the authenticated entity', 'FORBIDDEN', 403)
  }

  const entity = await prisma.entity.findUnique({ where: { id: auth.entityId! } })
  if (!entity) return err('Entity not found', 'NOT_FOUND', 404)

  const adminUser = await prisma.user.findFirst({
    where: { entityId: auth.entityId!, role: 'ADMIN' },
    select: { id: true },
  })
  if (!adminUser) return err('No admin user found for entity', 'INTERNAL_ERROR', 500)

  const document = await prisma.document.create({
    data: {
      entityId: auth.entityId!,
      documentType,
      blobUrl,
      fileName,
      fileType: fileName.split('.').pop() ?? 'pdf',
      submittedById: adminUser.id,
      status: 'PENDING',
    },
  })

  await inngest.send({
    name: 'document/uploaded',
    data: {
      documentId: document.id,
      entityId: auth.entityId!,
      entityName: entity.legalName,
      documentType,
      reportingPeriodEnd,
    },
  })

  return NextResponse.json({ documentId: document.id, status: 'PENDING' }, { status: 201 })
}
