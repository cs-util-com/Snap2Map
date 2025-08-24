// Set rootDir to the repository root so Jest can find tests and source files
// Since this config file is in ./config, we need to go up one level to reach the repo root
module.exports = {
  rootDir: '../',
  // Point Jest to the 'tests' directory for all test files
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/e2e/**/*.test.js',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.stryker-tmp/'],
  collectCoverage: true,
  // Include all source files so we can track coverage for the entire project
  collectCoverageFrom: [
    'src/**/*.js',
  ],
  coverageReporters: ["json", "lcov", "text", "clover"],
  // coverageThreshold: {
  //   global: {
  //     branches: 90,
  //     functions: 90,
  //     lines: 90,
  //     statements: 90,
  //   },
  // },
  testEnvironment: 'jsdom',
};
