// The settings every Sentry runtime (server, edge, browser) starts with.
//
// Arbor holds certified customer records, so the SDK's defaults collect far too
// much: request bodies carry document text, database parameters and AI inputs
// carry certified values, cookies carry the session. Only what is needed to find
// a bug leaves. URLs are scrubbed as well, because five routes take an access
// token in the path and reset and verification links carry one in the query.
//
// No Node imports: the browser and edge configs load this too.

// The arbor project in the nucleos-7q organisation, EU region (Frankfurt).
// A DSN is public by design; it is in every page the browser loads.
const DSN = 'https://97f1f842b898ef70c4b691b5e40e2773@o4511428752834560.ingest.de.sentry.io/4512296301625424'

// The routes whose next path segment is the credential (src/app/**/[token]).
const TOKEN_ROUTE = /(\/(?:api\/submit|api\/supplier-form|submit|supplier|share)\/)[^/?#\s"'<>]+/g

// A query string on anything that looks like a path or URL.
const QUERY = /((?:https?:\/\/|\/)[^\s?#"'<>]*)\?[^\s#"'<>]*/g

/** Every string inside `value` with token segments masked and query strings removed. */
export function scrubUrls<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(TOKEN_ROUTE, '$1[token]').replace(QUERY, '$1') as T
  }
  if (Array.isArray(value)) return value.map(v => scrubUrls(v)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubUrls(v)])) as T
  }
  return value
}

export function sentryOptions(env: Record<string, string | undefined>) {
  // Vercel sets VERCEL_ENV on the server and NEXT_PUBLIC_VERCEL_ENV for the browser.
  const environment = env.VERCEL_ENV ?? env.NEXT_PUBLIC_VERCEL_ENV ?? 'development'
  // Trace headers on our own routes and Nucleos only, not on every outgoing call.
  const nucleos = env.NUCLEOS_URL ? new URL(env.NUCLEOS_URL).origin : null
  return {
    dsn: DSN,
    enabled: environment === 'production' || environment === 'preview',
    environment,
    tracesSampleRate: 0.1,
    tracePropagationTargets: nucleos ? [/^\//, nucleos] : [/^\//],
    initialScope: { tags: { service: 'arbor' } },
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['user-agent', 'content-type', 'accept'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeSend: <E>(event: E) => scrubUrls(event),
    // SDK 11 streams spans, so this, not beforeSendTransaction, is the span hook.
    beforeSendSpan: <S>(span: S) => scrubUrls(span),
  }
}
