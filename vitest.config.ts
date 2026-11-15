import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    fileParallelism: false,
    testTimeout: 15000,
    exclude: ['**/tests/visual/**', '**/tests/stress/**', '**/tests/monitoring/e2e/**', '**/node_modules/**'],
  },
})

