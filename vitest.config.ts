import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Resolve workspace packages to their TypeScript sources (see "source" export condition).
    conditions: ['source'],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'examples/*/test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
