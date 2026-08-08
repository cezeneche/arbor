import { inngest } from '@/inngest/client'
import { prisma } from '@/lib/prisma'
import { sendNotification } from '@/lib/notifications'
import type { DocumentType } from '@prisma/client'
import {
  classifyCertificateExpiry,
  certificateFlagReason,
  certificateCoversPeriod,
  expiredCertificateFlagMessage,
  daysUntil,
} from '@/lib/validation/certificate-expiry'

const CERTIFICATE_DOCUMENT_TYPES: DocumentType[] = [
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


// per-entity tallies so each entity receives at most one expiring email
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

    const tallies = new Map<string, EntityTally>()
    function tally(entityId: string): EntityTally {
      let t = tallies.get(entityId)
      if (!t) {
        t = { expiringCount: 0, expiredCount: 0, soonestLabel: '', soonestDays: Infinity, expiredDetail: '' }
        tallies.set(entityId, t)
      }
      return t
    }

    // ── Certificate expiry ──────────────────────────────────────────────────────
    // Every expiry field on an accepted certificate is re-examined on every run,
    // not only the ones still unflagged. Filtering on flagged=false meant the
    // 30-day warning set the flag and thereby excluded the field for ever: a
    // certificate warned about in March was never re-read in April and never
    // became expired. State is recomputed from the date; the stored flagReason
    // only decides whether anything needs writing.
    const expiryFields = await step.run('find-expiry-fields', async () => {
      return prisma.extractedField.findMany({
        where: {
          fieldName: 'expiry_date',
          rawValue: { not: null },
          extractionJob: {
            document: {
              documentType: { in: CERTIFICATE_DOCUMENT_TYPES },
              status: 'ACCEPTED',
            },
          },
        },
        include: {
          extractionJob: {
            select: {
              document: {
                select: {
                  id: true,
                  entityId: true,
                  documentType: true,
                  dataRecords: {
                    where: { isActive: true },
                    select: { id: true, periodEnd: true },
                  },
                },
              },
            },
          },
        },
      })
    })

    let expiredCount = 0
    let expiringCount = 0
    let recordsFlagged = 0

    for (const field of expiryFields) {
      const raw = field.rawValue as string
      const { state, expiryDate } = classifyCertificateExpiry(raw, today)
      if (state === 'UNREADABLE' || state === 'VALID' || !expiryDate) continue

      const document = field.extractionJob.document
      const entityId = document.entityId
      const label = readableType(document.documentType)
      const remaining = daysUntil(expiryDate, today)
      const reason = certificateFlagReason(state, raw, remaining)!

      // Only write when the state has actually moved on, so a daily cron does not
      // rewrite the same row and re-notify for the same fact.
      const alreadyRecorded = field.flagged && field.flagReason === reason
      if (!alreadyRecorded) {
        await step.run(`flag-${state.toLowerCase()}-${field.id}`, async () => {
          await prisma.extractedField.update({
            where: { id: field.id },
            data: { flagged: true, flagReason: reason },
          })
        })
      }

      if (state === 'EXPIRED') {
        // Records are never rewritten (PRD §20.3), so an expired certificate does
        // not silently restate a tier that was correct when it was assigned. What
        // it does is put a visible flag on the records whose period the
        // certificate no longer covers, so the weakness travels with the figure.
        // step.run returns JSON, so dates come back as strings.
        const uncovered = document.dataRecords
          .map(r => ({ id: r.id, periodEnd: new Date(r.periodEnd) }))
          .filter(r => !certificateCoversPeriod(expiryDate, r.periodEnd))
        for (const record of uncovered) {
          const created = await step.run(`flag-record-${record.id}`, async () => {
            const existing = await prisma.validationFlag.findFirst({
              where: { dataRecordId: record.id, flagType: 'EXPIRED_CERTIFICATE', resolvedAt: null },
              select: { id: true },
            })
            if (existing) return false
            await prisma.validationFlag.create({
              data: {
                dataRecordId: record.id,
                flagType: 'EXPIRED_CERTIFICATE',
                severity: 'CRITICAL',
                message: expiredCertificateFlagMessage(raw, record.periodEnd),
              },
            })
            return true
          })
          if (created) recordsFlagged++
        }

        if (!alreadyRecorded) {
          const t = tally(entityId)
          t.expiredCount++
          if (!t.expiredDetail) t.expiredDetail = `Your ${label} expired on ${raw}.`
          expiredCount++
        }
      } else if (!alreadyRecorded) {
        const t = tally(entityId)
        t.expiringCount++
        if (remaining < t.soonestDays) {
          t.soonestDays = remaining
          t.soonestLabel = `Your ${label} expires in ${remaining} day${remaining === 1 ? '' : 's'}`
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
      recordsFlagged,
      checkedCount: expiryFields.length,
      entitiesNotified: tallies.size,
    }
  },
)
