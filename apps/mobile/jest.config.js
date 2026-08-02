/**
 * Minimal Jest setup for pure-TS utility tests only (no React Native rendering, so no jest-expo
 * preset / RN mocking needed) — scoped to files with zero RN/Expo imports, like utils/dates.ts.
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
