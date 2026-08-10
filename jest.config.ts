import type { Config } from 'jest'

const config: Config = {
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // nucleos/ ships its own Next.js apps with their own test setups, and its
  // Python suite runs under pytest. Arbor's jest covers Arbor.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/nucleos/'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', strict: true } }],
    // Transform ESM-only node_modules (otplib and its deps ship as ESM)
    '^.+\\.js$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', strict: false }, diagnostics: false }],
  },
  // Transform ESM packages that Jest would otherwise skip
  transformIgnorePatterns: [
    '/node_modules/(?!(otplib|@otplib|@scure|@noble)/)',
  ],
  // Per-file environment overrides applied via @jest-environment docblock in .tsx test files
}

export default config
