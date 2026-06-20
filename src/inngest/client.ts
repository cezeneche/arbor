import { Inngest } from 'inngest'

// Force cloud mode in production. Without an explicit `isDev`, the SDK can fall
// back to the local Inngest dev server (127.0.0.1:8288) even when deployed —
// so `inngest.send()` fails with ECONNREFUSED and the serve endpoint returns
// unsigned responses (Inngest "Sync app" then reports "SDK response was not
// signed. Is it in dev mode?"). NODE_ENV is 'production' on Vercel deployments
// and 'development' under `next dev`, so this uses Inngest Cloud when deployed
// and the local dev server when developing. Event/signing keys are read from
// INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY automatically.
export const inngest = new Inngest({
  id: 'arbor',
  isDev: process.env.NODE_ENV !== 'production',
})
