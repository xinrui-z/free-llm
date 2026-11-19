import { test, expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
const catalog = readdirSync('src/data/providers').filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => JSON.parse(readFileSync(`src/data/providers/${f}`, 'utf8')));
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({page}) => { pageErrors.set(page, []); page.on('pageerror', error => pageErrors.get(page)!.push(error.message)); });
test.afterEach(({page}) => { expect(pageErrors.get(page)).toEqual([]); });
const active = catalog.filter(p => p.status === 'active');
async function mock(page: Page, status = 'active', stale = false) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'status.test') {
      if (url.pathname === '/api/status') return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: {
        last_checked: new Date(Date.now() - (stale ? 3 * 3600_000 : 0)).toISOString(),
        providers: active.map(p => ({ id: p.id, status: p.id === 'groq' ? status : 'active', latency_ms: 123, history_90d: [...Array(83).fill('unknown'), ...Array(7).fill('active')] })),
      } });
      return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: [{ id: 'xss', provider_id: 'groq', provider_name: 'Groq', date: '2026-11-16', type: 'model_added', title: '<img data-injected src=x onerror=alert(1)>', description: '<script>alert(1)</script>' }] });
    }
    return route.abort();
  });
}
test('static provider search supports deep links, typing, clearing and status filters', async ({page}) => {
  await mock(page, 'dead');
  await page.goto('/providers?q=groq');
  await expect(page.locator('[data-provider-id]:visible')).toHaveCount(1);
  await expect(page.locator('#search-input')).toHaveValue('groq');
  await page.getByLabel('Search providers or models').fill('no-such-provider');
  await expect(page.locator('#provider-empty')).toBeVisible();
  await page.getByLabel('Clear search').click();
  await expect(page.locator('[data-provider-id]:visible')).toHaveCount(active.length);
  await page.getByRole('button', {name:'Down', exact:true}).click();
  await expect(page.locator('[data-provider-id]:visible')).toHaveCount(1);
  await expect(page.locator('[data-provider-id="groq"]')).toBeVisible();
});
test('model page reads live status and labels unpublished quotas honestly', async ({page}) => {
  await mock(page, 'dead');
  await page.goto('/models');
  await expect(page.locator('.provider-status-dot[data-provider-id="groq"]').first()).toHaveAttribute('title', 'Probe status: dead');
  await expect(page.getByText('Not published', {exact:true}).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('∞/d');
});
test('history excludes unobserved days and shows coverage', async ({page}) => {
  await mock(page);
  await page.goto('/providers/groq');
  await expect(page.locator('[data-live-uptime]').first()).toHaveText('100.0%');
  await expect(page.locator('#history-coverage')).toContainText('7 healthy / 7 observed days');
});
test('stale monitoring snapshots never show providers as operational', async ({page}) => {
  await mock(page, 'active', true);
  await page.goto('/');
  await expect(page.locator('#count-unknown')).toHaveText(String(active.length));
  await expect(page.locator('#count-active')).toHaveText('0');
  await expect(page.locator('#last-checked-label')).toContainText('stale');
});
test('changelog treats API content as text on both pages', async ({page}) => {
  await mock(page);
  for (const path of ['/changelog', '/']) {
    await page.goto(path);
    await expect(page.getByText('<img data-injected src=x onerror=alert(1)>', {exact:path==='/changelog'})).toBeVisible();
    await expect(page.locator('img[data-injected]')).toHaveCount(0);
  }
});
test('archived services remain discoverable but are excluded from free recommendations', async ({page}) => {
  await mock(page);
  await page.goto('/');
  await expect(page.locator('.provider-row')).toHaveCount(active.length);
  await expect(page.locator('.provider-row[data-provider-id="github-models"]')).toHaveCount(0);
  await page.goto('/providers/github-models');
  await expect(page.getByText('Archived from the free API directory.')).toBeVisible();
});
test('static changelog survives monitoring failure', async ({page}) => {
  await page.route('https://status.test/**', route=>route.abort());
  await page.goto('/changelog');
  await expect(page.locator('.changelog-entry').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Failed to load');
});

test('mobile pages stay within the viewport and pricing sorts by keyboard', async ({page}, testInfo) => {
  await mock(page);
  await page.setViewportSize({width:390,height:844});
  for (const path of ['/', '/models', '/providers', '/providers/groq', '/pricing', '/configs', '/changelog']) {
    await page.goto(path);
    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.page, `${path} should fit the mobile viewport`).toBeLessThanOrEqual(dimensions.viewport);
  }
  await page.goto('/');
  const triggers = await page.locator('.status-tip:visible > [tabindex="0"]').all();
  expect(triggers.length).toBeGreaterThanOrEqual(3);
  for (const trigger of triggers) {
    await trigger.focus();
    await expect(page.locator('.status-tip:focus-within .status-tip-panel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'open status tooltip should fit the mobile viewport').toBeLessThanOrEqual(390);
  }
  await page.goto('/pricing');
  const output = page.locator('[data-sort-key="output"]');
  await output.focus();
  await page.keyboard.press('Enter');
  await expect(output).toHaveAttribute('aria-sort','descending');
  await page.locator('#pricing-table').evaluate(table => { table.parentElement!.scrollLeft = 0; });
  await output.blur();
  await page.screenshot({path:testInfo.outputPath('pricing-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/');
  await page.screenshot({path:testInfo.outputPath('dashboard-desktop.png'),fullPage:true});
});
