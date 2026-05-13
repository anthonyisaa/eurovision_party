import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Minimal vitest config — we only run pure scoring tests in this package,
// no React rendering. The path alias mirrors apps/web/tsconfig.json so
// `import ... from '@/lib/...'` works.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
