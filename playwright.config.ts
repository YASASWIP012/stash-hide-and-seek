import { defineConfig, devices } from '@playwright/test';

// BASE_URL points the click-through at the live site; without it, a local preview build is used.
const base = process.env.BASE_URL ?? 'http://localhost:4319';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  retries: 0,
  use: { baseURL: base, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.BASE_URL ? undefined : { command: 'npx vite build && npx vite preview --port 4319 --strictPort', port: 4319, reuseExistingServer: false, timeout: 120_000 },
});
