# A deploy filled Nucleos's disk at start-up

**Date:** 7 November 2026 · **Duration:** 17 minutes (13:54 to about 14:11 UTC) · **Severity:** SEV-2 · **Affected:** CBAM features (Nucleos). Arbor kept serving.

## What happened

After the production-hardening PR (#157) deployed, every request to Nucleos failed with `FUNCTION_INVOCATION_FAILED`. The function never started. Its log said: "Runtime dependency installation failed … pandas … No space left on device (os error 28)".

## Timeline (UTC)

- **13:54:18** #157 merged. Nucleos deploys at 13:54:23.
- **13:55:15** first failed request in Nucleos's runtime log.
- **Shortly after** a manual check after the merge finds Arbor's `/api/health/ready` returning 503 and Nucleos's `/ready` returning 500, still failing after a minute of retries, so not a cold start. The runtime log shows pandas failing to unpack: no space left on device. The build logs show the bundle at 447.79 MB, against 447.78 MB for the previous deploy.
- **14:10:33** #158 merged, removing five unused packages. Deploy at 14:10:37.
- **About 14:11** `/ready` returns 200 with `{db: ok, schema: ok}` three times in a row. Arbor is ready again.

## Why it happened

1. Nucleos couldn't start because installing its dependencies at start-up ran out of disk space in `/tmp`.
2. Dependencies were being installed at start-up because the bundle (448 MB) is over Vercel's standard size. Vercel then defers some packages to a start-up install into `/tmp`.
3. pandas, one of the largest packages, landed in that deferred set this time because #157 added about 10 KB of code. The previous deploy was 10 KB smaller and only just fitted.
4. The bundle was that large because `requirements.txt` carried packages nothing used: onnxruntime (69 MB), sympy (79 MB) and three more. The legacy `builds` configuration also caps the function at 50 MB.
5. **Root cause:** the bundle was right at a platform limit and nothing measured it, so an unrelated change tipped it over.

## Why we didn't know sooner

There was no uptime monitor and no bundle-size check. Found within minutes only because someone checked readiness after the merge.

## What changed

- **#158:** removed onnxruntime, sympy, mpmath, flatbuffers and tokenizers, which nothing imports or needs. The bundle went from 448 MB to 363 MB. The full Nucleos suite passes with them uninstalled.
- The preview of #158 was checked with an authenticated request before merging.

## Still to do

- **The bundle is still over the standard size.** Either move Nucleos off the legacy `builds` setting in `vercel.json`, or add a CI check that fails when the bundle grows past a set size.
- An uptime monitor (O1).
