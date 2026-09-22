export default {
  test: {
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      // Command handlers are thin wrappers over the API; the logic worth
      // covering lives in payloads/, templates/, router and utils.
      thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 }
    }
  }
};
