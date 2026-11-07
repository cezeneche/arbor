import { scrubUrls, sentryOptions } from '@/lib/sentry-options'

describe('sentryOptions', () => {
  // Expected: on only in Vercel production and preview. Reason: local runs and
  // tests would fill Sentry with noise and send development data to a third party.
  it.each([
    [{ VERCEL_ENV: 'production' }, true, 'production'],
    [{ VERCEL_ENV: 'preview' }, true, 'preview'],
    [{ NEXT_PUBLIC_VERCEL_ENV: 'production' }, true, 'production'],
    [{ VERCEL_ENV: 'development' }, false, 'development'],
    [{}, false, 'development'],
  ])('%j → enabled %s in %s', (env, enabled, environment) => {
    const o = sentryOptions(env)
    expect(o.enabled).toBe(enabled)
    expect(o.environment).toBe(environment)
  })

  // Expected: an EU DSN. Reason: Arbor's error data must stay in the EU region
  // (nucleos-7q, Frankfurt); a US DSN here would move it.
  it('reports to the EU region', () => {
    expect(new URL(sentryOptions({}).dsn!).hostname).toMatch(/\.ingest\.de\.sentry\.io$/)
  })

  // Expected: tagged service=arbor. Reason: the alert receiver names the system
  // from this tag (src/lib/alerts/sentry.ts).
  it('tags every event as Arbor', () => {
    expect(sentryOptions({}).initialScope).toEqual({ tags: { service: 'arbor' } })
  })

  // Expected: trace headers only on our own routes and Nucleos. Reason: by
  // default the SDK adds them to every outgoing call (Anthropic, Resend, Slack,
  // customers' webhook URLs); Nucleos is the one downstream that joins the trace.
  it('propagates traces only to Arbor itself and Nucleos', () => {
    expect(sentryOptions({ NUCLEOS_URL: 'https://nucleos-api.vercel.app/' }).tracePropagationTargets).toEqual(
      [/^\//, 'https://nucleos-api.vercel.app'],
    )
    expect(sentryOptions({}).tracePropagationTargets).toEqual([/^\//])
  })

  it('samples a tenth of traces in production', () => {
    expect(sentryOptions({ VERCEL_ENV: 'production' }).tracesSampleRate).toBe(0.1)
  })

  // Expected: nothing that can carry customer data or credentials leaves.
  // Reason: request bodies carry document text, database parameters and AI
  // inputs carry certified values, cookies carry the session.
  it('collects no bodies, cookies, user data, query values, variables or AI text', () => {
    expect(sentryOptions({}).dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['user-agent', 'content-type', 'accept'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    })
  })

  // Expected: errors and spans scrubbed before they are sent. Reason:
  // dataCollection does not cover URLs inside messages, breadcrumbs and span
  // attributes. SDK 11 streams spans by default, so beforeSendSpan is the span
  // hook; beforeSendTransaction would be ignored.
  it('scrubs errors and spans before they are sent', () => {
    const o = sentryOptions({})
    const event = { request: { url: 'https://arbor.test/submit/abc123?token=x' } }
    expect(o.beforeSend(event)).toEqual({ request: { url: 'https://arbor.test/submit/[token]' } })
    const span = { name: 'GET /share/abc', attributes: { 'url.full': 'https://arbor.test/share/abc?x=1' } }
    expect(o.beforeSendSpan(span as never)).toEqual({
      name: 'GET /share/[token]',
      attributes: { 'url.full': 'https://arbor.test/share/[token]' },
    })
    expect(o).not.toHaveProperty('beforeSendTransaction')
  })
})

describe('scrubUrls', () => {
  // Expected: the token segment replaced. Reason: on these routes the path
  // segment is the credential; anyone holding it can open the link.
  it.each([
    ['/submit/tok_1', '/submit/[token]'],
    ['/supplier/tok_1/form', '/supplier/[token]/form'],
    ['/share/tok_1', '/share/[token]'],
    ['/api/submit/tok_1', '/api/submit/[token]'],
    ['/api/supplier-form/tok_1', '/api/supplier-form/[token]'],
    ['https://arbor.test/share/abc', 'https://arbor.test/share/[token]'],
    ['GET /submit/abc failed', 'GET /submit/[token] failed'],
  ])('%s → %s', (input, expected) => {
    expect(scrubUrls(input)).toBe(expected)
  })

  // Expected: query strings removed. Reason: reset and verification links carry
  // their token there, and others carry email addresses.
  it.each([
    ['/reset-password?token=secret', '/reset-password'],
    ['https://arbor.test/api/records?email=a@b.c&page=2', 'https://arbor.test/api/records'],
    ['/a?x=1#frag', '/a#frag'],
  ])('%s → %s', (input, expected) => {
    expect(scrubUrls(input)).toBe(expected)
  })

  it('leaves look-alike routes and prose alone', () => {
    expect(scrubUrls('/suppliers/abc')).toBe('/suppliers/abc')
    expect(scrubUrls('/api/shares/abc')).toBe('/api/shares/abc')
    expect(scrubUrls('Is the database up? No.')).toBe('Is the database up? No.')
  })

  it('walks nested objects and arrays, leaving other values untouched', () => {
    expect(
      scrubUrls({
        breadcrumbs: [{ data: { url: '/share/abc?x=1', status: 200 } }],
        spans: [{ description: 'GET /api/submit/t' }],
        n: 1,
        ok: true,
        none: null,
      }),
    ).toEqual({
      breadcrumbs: [{ data: { url: '/share/[token]', status: 200 } }],
      spans: [{ description: 'GET /api/submit/[token]' }],
      n: 1,
      ok: true,
      none: null,
    })
  })
})
