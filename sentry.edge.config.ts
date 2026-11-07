// Sentry for the edge runtime (the proxy). Settings and data policy: src/lib/sentry-options.ts.
import * as Sentry from '@sentry/nextjs'
import { sentryOptions } from './src/lib/sentry-options'

Sentry.init(sentryOptions(process.env))
