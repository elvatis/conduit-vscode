import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    alias: {
      vscode: path.resolve(__dirname, 'src/__mocks__/vscode.ts'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        'src/__mocks__/**',
        'src/extension.ts',  // pure wiring, hard to unit test
      ],
    },
  },
});
