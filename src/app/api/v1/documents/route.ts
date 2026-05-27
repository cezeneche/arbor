import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateApiKey } from '@/lib/api-key-auth'
import { err } from '@/lib/api-helpers'
import { inngest } from '@/inngest/client'

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req.headers.get('authorization'))
  if (!auth.authorized) {
    return err(auth.reason ?? 'Unauthorized', 'UNAUTHORIZED', 401)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return err('Invalid JSON body', 'INVALID_BODY', 400)
  }

  const { documentType, blobUrl, fileName, reportingPeriodEnd } = body as {
    documentType: string
    blobUrl: string
    fileName: string
    reportingPeriodEnd?: string
  }

  if (!documentType || !blobUrl || !fileName) {
    return err('documentType, blobUrl, and fileName are required', 'MISSING_FIELDS', 400)
  }

  const entity = await prisma.entity.findUnique({ where: { id: auth.entityId! } })
  if (!entity) return err('Entity not found', 'NOT_FOUND', 404)

  const document = await prisma.document.create({
    data: {
      entityId: auth.entityId!,
      documentType: documentType as never,
      blobUrl,
      fileName,
      fileType: fileName.split('.').pop() ?? 'pdf',
      submittedById: entity.id,
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
