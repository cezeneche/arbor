import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'

const CERTIFICATE_DOCUMENT_TYPES = [
  'PRODUCT_CERTIFICATE',
  'ENVIRONMENTAL_CERTIFICATE',
  'RENEWABLE_CERTIFICATE',
  'LAND_USE_CERTIFICATE',
]

export const checkCertificateExpiryFunction = inngest.createFunction(
  {
    id: 'check-certificate-expiry',
    triggers: [{ cron: '0 6 * * *' }],
  },
  async ({ step }) => {
    const today = new Date()
    const warningThreshold = new Date(today)
    warningThreshold.setDate(warningThreshold.getDate() + 30)

    const expiryFields = await step.run('find-expiry-fields', async () => {
      return prisma.extractedField.findMany({
        where: {
          fieldName: 'expiry_date',
          rawValue: { not: null },
          extractionJob: {
            document: {
              documentType: { in: CERTIFICATE_DOCUMENT_TYPES as never[] },
              status: 'ACCEPTED',
            },
          },
        },
        include: {
          extractionJob: {
            select: {
              documentId: true,
              document: { select: { entityId: true, documentType: true } },
            },
          },
        },
      })
    })

    let expiredCount = 0
    let expiringCount = 0

    for (const field of expiryFields) {
      const expiryDate = new Date(field.rawValue as string)
      if (isNaN(expiryDate.getTime())) continue

      if (expiryDate < today) {
        await step.run(`flag-expired-${field.id}`, async () => {
          await prisma.extractedField.update({
            where: { id: field.id },
            data: {
              flagged: true,
              flagReason: `Certificate expired ${field.rawValue}. Document is no longer valid for the current reporting period.`,
            },
          })
        })
        expiredCount++
      } else if (expiryDate < warningThreshold) {
        await step.run(`flag-expiring-${field.id}`, async () => {
          await prisma.extractedField.update({
            where: { id: field.id },
            data: {
              flagged: true,
              flagReason: `Certificate expires ${field.rawValue} — within 30 days. Renew before reporting period end.`,
            },
          })
        })
        expiringCount++
      }
    }

    return { expiredCount, expiringCount, checkedCount: expiryFields.length }
  },
)
