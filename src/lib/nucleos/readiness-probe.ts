// Whether Nucleos can answer, for Arbor's readiness check.
//
// A cold Nucleos takes 20–45 s to start, longer than an uptime monitor waits,
// so a probe that times out is reported as slow rather than down: readiness
// stays green with a warning, and a deploy is not an outage. A refusal, an
// error answer or an unknown host is a real failure.

export type NucleosProbe =
  | { ok: true; slow?: undefined; detail?: undefined }
  | { ok: true; slow: true; detail: string }
  | { ok: false; detail: string }

const DEFAULT_TIMEOUT_MS = 3000

export async function probeNucleos(
  url: string | undefined,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<NucleosProbe> {
  if (!url) return { ok: false, detail: 'NUCLEOS_URL is not set.' }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${url}/ready`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    return res.ok ? { ok: true } : { ok: false, detail: `Nucleos reported ${res.status}.` }
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: true, slow: true, detail: `Nucleos did not answer within ${timeoutMs / 1000} s.` }
    }
    return { ok: false, detail: 'Nucleos did not answer.' }
  }
}
