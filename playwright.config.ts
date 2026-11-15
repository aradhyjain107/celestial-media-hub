import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3000',
  },
});
