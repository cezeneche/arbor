import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'

const CERTIFICATE_DOCUMENT_TYPES = [
  'PRODUCT_CERTIFICATE',
  'ENVIRONMENTAL_CERTIFICATE',
  'RENEWABLE_CERTIFICATE',
  'LAND_USE_CERTIFICATE',
]

function readableType(documentType: string): string {
  return documentType
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function daysUntil(date: Date, from: Date): number {
  return Math.ceil((date.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

// Gap 2 — per-entity tallies so each entity receives at most one expiring email
// and one expired email per run, in plain English.
interface EntityTally {
  expiringCount: number
  expiredCount: number
  soonestLabel: string
  soonestDays: number
  expiredDetail: string
}

export const checkCertificateExpiryFunction = inngest.createFunction(
  {
    id: 'check-certificate-expiry',
    triggers: [{ cron: '0 6 * * *' }],
  },
  async ({ step }) => {
    const today = new Date()
    const warningThreshold = new Date(today)
    warningThreshold.setDate(warningThreshold.getDate() + 30)

    const tallies = new Map<string, EntityTally>()
    function tally(entityId: string): EntityTally {
      let t = tallies.get(entityId)
      if (!t) {
        t = { expiringCount: 0, expiredCount: 0, soonestLabel: '', soonestDays: Infinity, expiredDetail: '' }
        tallies.set(entityId, t)
      }
      return t
    }

    // ── Certificate expiry — only newly-detected (flagged=false) fields ──────────
    const expiryFields = await step.run('find-expiry-fields', async () => {
      return prisma.extractedField.findMany({
        where: {
          fieldName: 'expiry_date',
          rawValue: { not: null },
          flagged: false,
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
      const entityId = field.extractionJob.document.entityId
      const label = readableType(field.extractionJob.document.documentType)

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
        const t = tally(entityId)
        t.expiredCount++
        if (!t.expiredDetail) t.expiredDetail = `Your ${label} expired on ${field.rawValue}.`
        expiredCount++
      } else if (expiryDate < warningThreshold) {
        await step.run(`flag-expiring-${field.id}`, async () => {
          await prisma.extractedField.update({
            where: { id: field.id },
            data: {
              flagged: true,
              flagReason: `Certificate expires ${field.rawValue}. Within 30 days. Renew before reporting period end.`,
            },
          })
        })
        const t = tally(entityId)
        t.expiringCount++
        const d = daysUntil(expiryDate, today)
        if (d < t.soonestDays) {
          t.soonestDays = d
          t.soonestLabel = `Your ${label} expires in ${d} day${d === 1 ? '' : 's'}`
        }
        expiringCount++
      }
    }

    // ── Batch/mill record staleness — records past staleAfterDate, not yet flagged ──
    const staleRecords = await step.run('find-stale-records', async () => {
      return prisma.dataRecord.findMany({
        where: {
          isActive: true,
          staleAfterDate: { not: null, lt: today },
          validationFlags: { none: { flagType: 'STALE_RECORD' } },
        },
        select: { id: true, entityId: true, fieldName: true, periodEnd: true },
      })
    })

    let staleCount = 0
    for (const record of staleRecords) {
      await step.run(`flag-stale-${record.id}`, async () => {
        await prisma.validationFlag.create({
          data: {
            dataRecordId: record.id,
            flagType: 'STALE_RECORD',
            severity: 'WARNING',
            message: `This record covers a period ending ${new Date(record.periodEnd).toISOString().slice(0, 10)} and is now stale. Upload a current document to refresh it.`,
          },
        })
      })
      const t = tally(record.entityId)
      t.expiredCount++
      if (!t.expiredDetail) t.expiredDetail = `One of your batch records has gone stale.`
      staleCount++
    }

    // ── One notification per entity per category ─────────────────────────────────
    for (const [entityId, t] of tallies.entries()) {
      if (t.expiringCount > 0) {
        await step.run(`notify-expiring-${entityId}`, async () => {
          await sendNotification({
            entityId,
            type: 'CERTIFICATE_EXPIRING',
            payload: { count: t.expiringCount, soonest: t.soonestLabel || 'A record expires soon' },
          })
        })
      }
      if (t.expiredCount > 0) {
        await step.run(`notify-expired-${entityId}`, async () => {
          await sendNotification({
            entityId,
            type: 'CERTIFICATE_EXPIRED',
            payload: { count: t.expiredCount, detail: t.expiredDetail || 'A record has expired.' },
          })
        })
      }
    }

    return {
      expiredCount,
      expiringCount,
      staleCount,
      checkedCount: expiryFields.length,
      entitiesNotified: tallies.size,
    }
  },
)
