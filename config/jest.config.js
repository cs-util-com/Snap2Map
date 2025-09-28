// Set rootDir to the repository root so Jest can find tests and source files
// Since this config file is in ./config, we need to go up one level to reach the repo root
module.exports = {
  rootDir: '../',
  testPathIgnorePatterns: ['/node_modules/', '/.stryker-tmp/'],
  collectCoverage: true,
  // Include all source files so newly added modules without tests are reported with 0% coverage
  // This ensures gaps (e.g. currently untested audio.js) are visible and will impact thresholds
  collectCoverageFrom: [
    'src/**/*.js',            // all JS sources
    '!src/**/*.test.js',      // exclude standard unit tests
    '!src/**/*.property.test.js', // exclude property-based tests
    '!src/**/__mocks__/**'    // exclude any mocks if added later
  ],
  transform: {
    // Use a double-escaped dot so the regex sees a literal dot and ESLint doesn't flag a useless escape
    '^.+\\.js$': ['babel-jest', { configFile: require.resolve('./babel.config.js') }],
  },
  moduleNameMapper: {
    '^snap2map/index$': '<rootDir>/src/index.js',
    '^snap2map/calibrator$': '<rootDir>/src/calibration/calibrator.js',
  },
  coverageReporters: ["json", "lcov", "text", "clover"],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  testEnvironment: 'jsdom',
};
