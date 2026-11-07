import * as Sentry from '@sentry/nextjs'
import { inngest } from '@/inngest/client'
import { inngestFailureReport, type InngestFailure } from '@/lib/monitoring/inngest-failure'

// Every Inngest function that exhausts its retries emits `inngest/function.failed`.
// This is the one place they reach Sentry, and from there the ops alerts.
export const reportFailuresFunction = inngest.createFunction(
  { id: 'report-failures', retries: 2, triggers: [{ event: 'inngest/function.failed' }] },
  async ({ event }) => {
    const report = inngestFailureReport(event.data as InngestFailure)
    Sentry.withScope(scope => {
      scope.setTags(report.tags)
      scope.setFingerprint(report.fingerprint)
      Sentry.captureException(report.error)
    })
    // A serverless function can be frozen once it returns; send before it is.
    await Sentry.flush(2_000)
    return { reported: report.tags['inngest.function'] }
  },
)
