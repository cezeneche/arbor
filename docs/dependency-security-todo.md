# Dependency security fixes

Created 9 November 2026 from GitHub's open Dependabot alerts: 32 open, 28 in Nucleos (`nucleos/api/requirements.txt`) and 4 in Arbor (`package-lock.json`). Every alert is listed under exactly one item. Done in this order, one at a time, each checked in CI, on a preview and in production before the next.

Why the pull requests keep coming: Dependabot was switched on 7 November (E5 in `docs/engineering-todo.md`) against a Nucleos requirements file that pins about 113 packages and had never been updated. Security updates open whenever an alert exists, not on the Monday schedule, so each merge can make room for the next. The flow slows once this list is done.

## Nucleos

- [x] **S1. Merge the four Dependabot security PRs.** All checks pass on each, and the four were installed together in a clean environment with no conflicts.
  - Done 9 November 2026: merged one at a time; Nucleos production ready, CI green and no log errors after each.
  - #199 anyio 4.12.1 → 4.14.2: alerts 145 (critical: TLS certificate spoofing through IDNA 2003 host name encoding), 144.
  - #200 fsspec 2026.2.0 → 2026.6.0: alert 168 (high: template injection in ReferenceFileSystem).
  - #201 urllib3 2.6.3 → 2.8.0: alerts 45, 46, 153, 154 (high), 155.
  - #202 multidict 6.7.1 → 6.9.1: alert 169.
- [x] **S2. FastAPI and Starlette.** Starlette 0.52.1 → 1.3.1 or later: alerts 72 and 66 (high), 50, 65, 71. FastAPI 0.128.8 accepts only Starlette 0.x, so Dependabot cannot open a PR for this; both move together. This is Nucleos's own web server, so it matters more than anything in S1. Checks: full Nucleos suite, the golden set unchanged, preview `/ready`, a real Arbor-to-Nucleos call.
  - Done 9 November 2026 (#209): Starlette 1.3.1 with FastAPI 0.133.1, the smallest FastAPI step that accepts Starlette 1.x (later releases change form and null handling). FastAPI 0.132 rejects JSON bodies without a JSON Content-Type: every Arbor call to Nucleos with a body sends one, and compliance-pack sends no body. 1,324 Nucleos tests and 37/37 golden checks passed; preview and production ready; unauthenticated calls still refused.
- [x] **S3. python-multipart** 0.0.22 → 0.0.31 or later: alerts 43 and 70 (high), 32, 67, 68, 69. It reads Nucleos's form posts and file uploads. Goes in with S2 if the new FastAPI requires it.
  - Done 9 November 2026 (#210), on its own: FastAPI 0.133.1 didn't need it.
- [x] **S4. soupsieve** 2.8.3 → 2.9.0 or later: alerts 80 and 81 (high), 142, 143. Comes in through beautifulsoup4; check that beautifulsoup4 4.14.3 accepts it.
  - Done 9 November 2026 (#203): soupsieve 2.9; beautifulsoup4 needs only >=1.6.1.
- [x] **S5. Small direct pins**, in one PR: requests 2.32.5 → 2.33.0 (alert 16), idna 3.11 → 3.15 (47), python-dotenv 1.2.1 → 1.2.2 (37), Pygments 2.19.2 → 2.20.0 (18).
  - Done in one PR, which replaces Dependabot's #211–#214.

## Arbor

- [ ] **S6. npm alerts.** All four come from other packages' dependencies, none from Arbor's own code.
  - zod 3.25.76 (alert 276, high: memory exhaustion validating oversized collections). Comes from `inngest`, which runs in production. Arbor's own zod is 4.6.7 and not affected. Fix: an `inngest` update if one moves to a fixed zod, otherwise an npm `overrides` entry, tested against the Inngest functions.
  - glob 10.5.0 (291) and minimatch 9.0.9 and 10.2.5 (292). From jest, typescript-eslint and, for glob, also `inngest` → gaxios → rimraf. Mostly development tooling. Fix with `overrides` if the parent packages haven't moved.
  - deepmerge 4.3.1 (286, low). From jest only, development tooling, and no fixed version exists. Dismiss with that reason recorded.

## Owner decision

- [ ] **S7. How much Dependabot to keep for Nucleos.** Once S1 to S5 are done, decide whether routine weekly version updates stay on (up to three PRs at a time) or Nucleos takes security updates only (one line in `.github/dependabot.yml`).
