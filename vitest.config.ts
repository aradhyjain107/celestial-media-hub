import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/vitest.setup.ts'],
    globals: true,
    fileParallelism: false,
    testTimeout: 15000,
    exclude: ['**/tests/visual/**', '**/tests/stress/**', '**/node_modules/**'],
  },
})

