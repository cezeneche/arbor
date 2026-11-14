import type { Config } from 'jest'

const config: Config = {
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // nucleos/ ships its own Next.js apps with their own test setups, and its
  // Python suite runs under pytest. Arbor's jest covers Arbor.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/nucleos/'],
  // rootDir: ts-jest compiles with an output directory of its own, and
  // TypeScript 6 requires rootDir to be set explicitly whenever one is (TS5011).
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', strict: true, rootDir: '.' } }],
    // Transform ESM-only node_modules (otplib and its deps ship as ESM)
    '^.+\\.js$': [
      'ts-jest',
      { tsconfig: { jsx: 'react-jsx', strict: false, rootDir: '.' }, diagnostics: false },
    ],
  },
  // Transform ESM packages that Jest would otherwise skip
  transformIgnorePatterns: ['/node_modules/(?!(otplib|@otplib|@scure|@noble)/)'],
  // Per-file environment overrides applied via @jest-environment docblock in .tsx test files
}

export default config
