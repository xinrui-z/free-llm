import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
// PW_CHROME_PATH wins; otherwise use a local macOS Chrome if present, else Playwright's bundled Chromium.
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = process.env.PW_CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined);
export default defineConfig({
  testDir: './tests',
  testIgnore: '**/dynamic.spec.ts',
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:4323',
    launchOptions: chrome ? { executablePath: chrome } : {},
  },
  webServer: {
    command: 'npm run build -- --outDir test-dist && npm run preview -- --outDir test-dist --ignore-lock --host 127.0.0.1 --port 4323',
    url: 'http://127.0.0.1:4323',
    reuseExistingServer: false,
    stdout: 'pipe',
    env: { PUBLIC_STATUS_WORKER_URL: 'https://status.test' },
  },
});
