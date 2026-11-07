// Sentry in the browser. Settings and data policy: src/lib/sentry-options.ts.
// Session Replay is deliberately off: it records what users see, which includes
// certified customer records.
import * as Sentry from '@sentry/nextjs'
import { sentryOptions } from '@/lib/sentry-options'

// Named literally: Next.js inlines only the env vars that appear in browser code.
Sentry.init(sentryOptions({ NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV }))

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
