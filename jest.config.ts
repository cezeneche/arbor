import type { Config } from 'jest'

const config: Config = {
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
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
