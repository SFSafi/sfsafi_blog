import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:4321', headless: true },
  webServer: [
    {
      command: 'npm run preview -- --port 4321 --ignore-lock',
      url: 'http://127.0.0.1:4321',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run db:local && npm run dev:worker',
      url: 'http://127.0.0.1:8787',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
  reporter: 'list',
});
