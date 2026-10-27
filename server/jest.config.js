/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setupEnv.ts'],
  // Transpile only (see tsconfig.jest.json): `npm run build` is the type check, so an
  // unrelated type error elsewhere in src doesn't stop the tests from running.
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }] },
};
