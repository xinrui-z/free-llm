import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
// PW_CHROME_PATH wins; otherwise use a local macOS Chrome if present, else Playwright's bundled Chromium.
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = process.env.PW_CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined);
// The fake catalog API uses its own port so it never collides with a locally running catalog API.
const catalogPort = process.env.CATALOG_TEST_PORT || '4334';
const catalogURL = `http://127.0.0.1:${catalogPort}`;
export default defineConfig({
  testDir: './tests', testMatch: '**/dynamic.spec.ts', workers: 1, outputDir: './dynamic-test-results',
  use: { baseURL:'http://127.0.0.1:4325', launchOptions:chrome?{executablePath:chrome}:{} },
  // CATALOG_CACHE_TTL_MS=0: the specs flip the fake catalog between requests and expect each page load to see it.
  webServer: [
    { command:'node tests/catalog-server.mjs',url:`${catalogURL}/api/catalog`,reuseExistingServer:false,env:{CATALOG_TEST_PORT:catalogPort} },
    { command:'npm run build -- --outDir dynamic-test-dist && npm run preview -- --outDir dynamic-test-dist --ignore-lock --host 127.0.0.1 --port 4325',
      url:'http://127.0.0.1:4325',reuseExistingServer:false,timeout:120000,stdout:'pipe',
      // CATALOG_TEST_CHECKER_UPSTREAM runs tests/fake-checker/worker.mjs as the free-llm-checker service, so pages
      // read the catalog through the real CHECKER binding. CATALOG_API_URL is also set: the binding must win over it.
      env:{CATALOG_MODE:'dynamic',CATALOG_API_URL:catalogURL,CATALOG_TEST_CHECKER_UPSTREAM:catalogURL,PUBLIC_STATUS_WORKER_URL:'https://status.test',CATALOG_CACHE_TTL_MS:'0'},
    },
  ],
});
