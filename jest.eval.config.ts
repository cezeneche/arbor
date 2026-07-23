// Config for the live pre-deploy eval gate ONLY. Mirrors the base jest transform
// / module mapping but matches the `.eval.ts` runner instead of the unit suite,
// so `npm run eval` hits the live model while `npm test` never does. Serial, with
// a long per-case timeout for real extraction latency. Kept self-contained (no
// import of jest.config.ts) because jest's TS-config loader cannot resolve a
// relative TS import.
import type { Config } from 'jest'

const config: Config = {
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['**/scripts/eval/**/*.eval.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', strict: true } }],
    '^.+\\.js$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', strict: false }, diagnostics: false }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(otplib|@otplib|@scure|@noble)/)'],
  testTimeout: 300_000,
  maxWorkers: 1,
}

export default config
