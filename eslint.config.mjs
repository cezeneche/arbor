import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // nucleos/ carries its own apps (legacy web and marketing) with their own
    // Next/React versions and lockfiles. Arbor's rules are not theirs; they are
    // linted and built in their own CI job.
    'nucleos/**',
    // Audit evidence: scripts kept exactly as they ran when an audit was
    // written. They are records, not code the app runs, and are not rewritten
    // to satisfy rules that postdate them.
    'docs/audits/**',
  ]),
])

export default eslintConfig
