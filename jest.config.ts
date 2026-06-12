import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  globals: {
    'ts-jest': { tsconfig: { jsx: 'react-jsx', strict: true } },
  },
  // Per-file environment overrides applied via @jest-environment docblock in .tsx test files
}

export default config
