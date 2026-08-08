import { NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { requireWriteAccess } from '@/lib/auth-helpers'
import { ok, err } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { storeDocument } from '@/lib/storage'
import { sniffFileType } from '@/lib/upload/sniff'
import { inngest } from '@/inngest/client'
import { documentTypeSchema, DOCUMENT_MAX_BYTES, ALLOWED_MIME_TYPES } from '@/lib/constants'
import { assertUploadAllowed } from '@/lib/plan-guard'

const bodySchema = z.object({
  documentType: documentTypeSchema,
  reportingPeriodEnd: z.string().datetime().optional(),
})

export async function POST(req: NextRequest) {
  const { session, response } = await requireWriteAccess()
  if (!session) return response!

  const entityId = getSessionUser(session).entityId as string
  if (!entityId) return err('Entity not found for session user', 'NO_ENTITY', 403)

  const uploadCheck = await assertUploadAllowed(entityId)
  if (!uploadCheck.allowed) return err(uploadCheck.reason!, 'PLAN_LIMIT', 402)

  let file: File | null = null
  let documentType: z.infer<typeof documentTypeSchema>
  let reportingPeriodEnd: string | undefined

  try {
    const formData = await req.formData()
    file = formData.get('file') as File | null
    const meta = bodySchema.safeParse({
      documentType: formData.get('documentType'),
      reportingPeriodEnd: formData.get('reportingPeriodEnd') ?? undefined,
    })
    if (!meta.success) return err('Invalid metadata', 'VALIDATION_ERROR', 400)
    documentType = meta.data.documentType
    reportingPeriodEnd = meta.data.reportingPeriodEnd
  } catch {
    return err('Invalid request body', 'PARSE_ERROR', 400)
  }

  if (!file) return err('No file provided', 'NO_FILE', 400)
  if (file.size > DOCUMENT_MAX_BYTES) return err('File exceeds 50 MB limit', 'FILE_TOO_LARGE', 413)
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return err('Unsupported file type. Accepted: PDF, JPEG, PNG', 'UNSUPPORTED_FILE_TYPE', 415)
  }

  // Trust the file's magic bytes, not the client-declared MIME. Reject spoofed
  // content even when the declared type is in the allowlist.
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const sniffedType = sniffFileType(header)
  if (!sniffedType) {
    return err('File content does not match a supported type (PDF, JPEG, PNG).', 'UNSUPPORTED_FILE_TYPE', 415)
  }

  const { url } = await storeDocument(file, entityId, sniffedType)

  const entity = await prisma.entity.findUnique({ where: { id: entityId } })
  if (!entity) return err('Entity not found', 'ENTITY_NOT_FOUND', 404)

  const document = await prisma.document.create({
    data: {
      entityId,
      fileName: file.name,
      fileType: sniffedType,
      documentType,
      blobUrl: url,
      submittedById: session.user!.id!,
      status: 'PENDING',
    },
  })

  try {
    await inngest.send({
      name: 'document/uploaded',
      data: {
        documentId: document.id,
        entityId,
        entityName: entity.legalName,
        documentType,
        reportingPeriodEnd,
      },
    })
  } catch (e) {
    // The file is stored, but nothing is going to read it. Left as PENDING the
    // document sits in the list saying "Reading your document…" for ever, and the
    // user has no way to tell that nothing is happening. Mark it so the state is
    // the truth and the sweeper below can pick it up.
    console.error('[upload] inngest.send failed for document', document.id, e)
    await prisma.document.update({
      where: { id: document.id },
      data: { status: 'REVIEW_REQUIRED' },
    }).catch(() => {})
    return ok(
      {
        documentId: document.id,
        status: 'REVIEW_REQUIRED',
        note: 'Your document was saved, but reading it could not be started. Try again from your documents list.',
      },
      201,
    )
  }

  return ok({ documentId: document.id, status: 'PENDING' }, 201)
}
