// Sentry for the Node.js server runtime. Settings and data policy: src/lib/sentry-options.ts.
import * as Sentry from '@sentry/nextjs'
import { sentryOptions } from './src/lib/sentry-options'

Sentry.init(sentryOptions(process.env))
