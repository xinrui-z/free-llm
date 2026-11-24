import { test, expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
const catalog = readdirSync('src/data/providers').filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => JSON.parse(readFileSync(`src/data/providers/${f}`, 'utf8')));
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({page}) => { pageErrors.set(page, []); page.on('pageerror', error => pageErrors.get(page)!.push(error.message)); });
test.afterEach(({page}) => { expect(pageErrors.get(page)).toEqual([]); });
const active = catalog.filter(p => p.status === 'active');
const archived = catalog.filter(p => p.status === 'archived');
const XSS_TITLE = '<img data-injected src=x onerror=alert(1)>';
async function mock(page: Page, status = 'active', stale = false) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'status.test') {
      if (url.pathname === '/api/status') return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: {
        last_checked: new Date(Date.now() - (stale ? 3 * 3600_000 : 0)).toISOString(),
        providers: active.map(p => ({ id: p.id, status: p.id === 'groq' ? status : 'active', latency_ms: 123, history_90d: [...Array(83).fill('unknown'), ...Array(7).fill('active')] })),
      } });
      return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: [{ id: 'xss', provider_id: 'groq', provider_name: 'Groq', date: '2026-11-16', type: 'model_added', title: XSS_TITLE, description: '<script>alert(1)</script>' }] });
    }
    return route.abort();
  });
}
// Desktop rows and mobile cards both carry data-pt-row; only one of them is visible at a given width.
const rows = (page: Page) => page.locator('[data-pt-row]:visible');
const row = (page: Page, id: string) => page.locator(`[data-pt-row][data-provider-id="${id}"]:visible`);

test('static provider search supports deep links, typing, clearing and status filters', async ({page}) => {
  await mock(page, 'dead');
  await page.goto('/?q=groq');
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'groq')).toBeVisible();
  await expect(page.locator('#dir-q')).toHaveValue('groq');
  await page.getByLabel('Search providers').fill('no-such-provider');
  await expect(page.locator('#dir-empty')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await page.locator('#dir-empty-clear').click();
  await expect(page.locator('#dir-q')).toHaveValue('');
  await expect(rows(page)).toHaveCount(active.length);
  // Status filters appear only with live data; "Issues" shows providers that are down or degraded.
  await expect(page.locator('html')).toHaveAttribute('data-live', 'live');
  await page.locator('[data-chip="st-issues"]').click();
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'groq')).toBeVisible();
});
test('the old /providers URL redirects to the directory and keeps the query', async ({page}) => {
  await mock(page);
  await page.goto('/providers?q=groq');
  await expect(page).toHaveURL(/\/\?q=groq$/);
  await expect(page.locator('#dir-q')).toHaveValue('groq');
  await expect(rows(page)).toHaveCount(1);
  await page.goto('/providers/?q=qwen#archived');
  await expect(page).toHaveURL(/\/\?q=qwen#archived$/);
  await expect(page.locator('#dir-q')).toHaveValue('qwen');
});
test('model page reads live status and labels unpublished quotas honestly', async ({page}) => {
  await mock(page, 'dead');
  await page.goto('/models');
  await expect(page.locator('.m-tbl [data-status-dot="groq"] .dot').first()).toHaveAttribute('title', 'Health: Down');
  await expect(page.getByRole('button', { name: /^Not published\./ }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('∞');
  await expect(page.locator('.m-tbl, .m-list')).not.toContainText([/unlimited/i, /unlimited/i]);
});
test('numbers are formatted the same way everywhere: 8,000 TPM, 128K context', async ({page}) => {
  await page.route('https://status.test/**', route => route.abort());
  const groq = page.locator('[data-pt-row][data-provider-id="groq"]:visible');
  await page.goto('/');
  await expect(groq).toContainText('8,000');
  await expect(groq).toContainText('128K');
  await expect(page.locator('main')).not.toContainText(/\b8K\b/);
  await expect(page.locator('main')).not.toContainText('131072');
  await page.goto('/providers/groq');
  const tier = page.locator('.lf-lg');
  await expect(tier).toContainText('8,000');
  await expect(tier).toContainText('128K');
  await expect(tier.locator('[title="131,072 tokens"]')).toHaveCount(1);
  await expect(page.locator('main')).not.toContainText(/\b8K\b/);
  await expect(page.locator('main')).not.toContainText('131072');
  await page.goto('/models?q=gpt-oss-20b');
  const listing = page.locator('.m-tbl tr:visible', { hasText: 'openai/gpt-oss-20b' });
  await expect(listing).toContainText('8,000');
  await expect(listing).toContainText('128K');
});
test('models are grouped by family or vendor, with no Other group for the bundled catalog', async ({page}) => {
  await mock(page);
  await page.goto('/models');
  // tests/model-families.test.mjs asserts every listable bundled model lands in a family or vendor group.
  await expect(page.locator('[data-m-group="other"]')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Other models');
  await expect(page.locator('.m-tbl tbody[data-m-group="glm"] [data-m-row]').first()).toBeVisible();
  // Desktop table and mobile list carry the same listings.
  await expect(page.locator('.m-tbl [data-m-row]')).toHaveCount(await page.locator('.m-list [data-m-row]').count());
});
test('pricing shows where each price comes from and how fresh it is', async ({page}) => {
  await mock(page);
  await page.goto('/pricing');
  await expect(page.locator('.ph .lead')).toContainText('Paid reference prices for when free quotas run out');
  await expect(page.locator('#pricing-freshness')).toContainText(/Price(s checked| dates from) \d{4}-\d{2}-\d{2}/);
  const chips = page.locator('#pr-src-chips');
  const manualStale = await page.locator('#pricing-table [data-pr-row][data-stale="true"]:not([data-archived="true"])').count();
  if (manualStale > 0) {
    await expect(page.locator('#pricing-table [data-pr-row][data-stale="true"]:visible .pr-stale').first()).toHaveText('May be outdated');
  } else {
    await expect(chips.locator('[data-src-provider="openrouter"]')).toContainText('Synced from live API');
    await expect(chips.locator('[data-src-provider="google-ai-studio"]')).toContainText('Synced daily from pricing page');
  }
  // Prices read daily from an official pricing page are auto-synced and never marked "May be outdated".
  await expect(page.locator('#pricing-table [data-pr-row][data-provider="google-ai-studio"]').first().locator('.pr-date')).toContainText('Auto-synced');
  await expect(page.locator('#pricing-table [data-pr-row][data-provider="google-ai-studio"][data-stale="true"]')).toHaveCount(0);
  // A provenance chip filters the table like the provider select, and pressing it again clears it.
  await chips.locator('[data-src-provider="groq"]').click();
  await expect(page.locator('#pr-provider')).toHaveValue('groq');
  await expect(page.locator('#pricing-table [data-pr-row]:visible')).toHaveCount(await page.locator('#pricing-table [data-pr-row][data-provider="groq"]').count());
  await chips.locator('[data-src-provider="groq"]').click();
  await expect(page.locator('#pr-provider')).toHaveValue('');
  await expect(page.locator('#pricing-table [data-pr-row]:visible').first()).toContainText(/./);
  await expect(page.locator('#pricing-table [data-pr-row][data-provider="openrouter"]').first().locator('.pr-date')).toContainText('Auto-synced');
});
test('history excludes unobserved days and shows coverage', async ({page}) => {
  await mock(page);
  await page.goto('/providers/groq');
  await expect(page.locator('#health')).toBeVisible();
  await expect(page.locator('[data-live-uptime]').first()).toHaveText('100.0%');
  await expect(page.locator('#history-coverage')).toContainText('7 healthy / 7 observed days');
});
test('stale monitoring snapshots never show providers as operational', async ({page}) => {
  await mock(page, 'active', true);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-live', 'stale');
  await expect(page.locator('[data-status-notice] [data-sn-text]')).toContainText('Health data is out of date');
  await expect(page.locator('[data-status-dot] .dot')).toHaveCount(0);
  await expect(page.locator('.d-active')).toHaveCount(0);
  await expect(page.locator('[data-chip="st-up"]')).toBeHidden();
  for (const id of active.map(p => p.id)) await expect(page.locator(`[data-pt-row][data-provider-id="${id}"]`).first()).toHaveAttribute('data-status', 'unknown');
  await page.goto('/providers/groq');
  await expect(page.locator('html')).toHaveAttribute('data-live', 'stale');
  await expect(page.locator('main')).not.toContainText('Operational');
  await expect(page.locator('#health')).toBeHidden();
});
test('changelog treats API content as text on both pages', async ({page}) => {
  await mock(page);
  for (const [path, scope] of [['/changelog', 'main'], ['/', '#recent-changes']]) {
    await page.goto(path);
    await expect(page.locator(scope).getByText(XSS_TITLE, {exact: true})).toBeVisible();
    await expect(page.locator('img[data-injected]')).toHaveCount(0);
  }
});
test('archived services remain discoverable but are excluded from free recommendations', async ({page}) => {
  await mock(page);
  await page.goto('/');
  await expect(rows(page)).toHaveCount(active.length);
  for (const p of archived) await expect(page.locator(`[data-pt-row][data-provider-id="${p.id}"]`)).toHaveCount(0);
  await expect(page.locator('#archived')).toContainText('GitHub Models');
  await page.goto('/providers/github-models');
  await expect(page.locator('.arch-box')).toContainText('No longer offers a recurring free tier.');
  await expect(page.locator('#quick-start')).toHaveCount(0);
  // Free alternatives on any page only ever point at active providers.
  const alternatives = await page.locator('#alternatives .pcard').evaluateAll(cards => cards.map(c => (c as HTMLAnchorElement).pathname.split('/').filter(Boolean).pop()));
  expect(alternatives.length).toBeGreaterThan(0);
  for (const id of alternatives) expect(active.map(p => p.id)).toContain(id);
});
test('quickest first call picks only active providers, published limits first', async ({page}) => {
  await mock(page);
  await page.goto('/');
  const picks = await page.locator('[data-pick]').evaluateAll(cards => cards.map(c => (c as HTMLElement).dataset.pick!));
  expect(picks.length).toBeGreaterThan(0);
  expect(picks.length).toBeLessThanOrEqual(3);
  const archivedIds = archived.map(p => p.id);
  for (const id of picks) expect(archivedIds).not.toContain(id);
  for (const id of picks) expect(active.map(p => p.id)).toContain(id);
  // Providers that publish a request limit come before those that publish none.
  const published = (id: string) => { const p = catalog.find(x => x.id === id); return p.rpm != null || p.tpm != null; };
  const flags = picks.map(published);
  expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
  expect(picks[0]).toBe('groq');
});
test('provider page ?model= selects the quick start model', async ({page}) => {
  await mock(page);
  await page.goto('/providers/groq?model=qwen/qwen3.8-27b');
  await expect(page.locator('#qs-model')).toHaveValue('qwen/qwen3.8-27b');
  await expect(page.locator('#qs-code-curl')).toContainText('qwen/qwen3.8-27b');
  await page.locator('[data-qs-lang="python"]').click();
  await expect(page.locator('#qs-code-python')).toContainText('qwen/qwen3.8-27b');
  await page.locator('#qs-model').selectOption('openai/gpt-oss-20b');
  await expect(page.locator('#qs-code-python')).toContainText('openai/gpt-oss-20b');
  await expect(page).toHaveURL(/[?&]model=openai%2Fgpt-oss-20b|[?&]model=openai\/gpt-oss-20b/);
  // An unknown model keeps the default model instead of inventing one.
  await page.goto('/providers/groq?model=not-a-model');
  await expect(page.locator('#qs-model')).toHaveValue(active.find(p => p.id === 'groq').top_models[0]);
  await expect(page.locator('#qs-code-curl')).not.toContainText('not-a-model');
});
test('Tools YAML only includes the selected providers', async ({page}) => {
  await mock(page);
  await page.goto('/configs');
  const yaml = page.locator('code#t-yaml');
  for (const p of active) await expect(yaml).toContainText(p.base_url);
  await page.locator('#t-none').click();
  await page.locator('input[data-tp="groq"]').check({ force: true });
  await expect(page.locator('#t-selcount')).toContainText('1');
  await expect(yaml).toContainText(active.find(p => p.id === 'groq').base_url);
  for (const p of active.filter(p => p.id !== 'groq')) await expect(yaml).not.toContainText(p.base_url);
  for (const p of archived) await expect(yaml).not.toContainText(`${p.id}/`);
  await expect(page.locator('#t-keys [data-tp-item]:visible')).toHaveCount(1);
});
test('static changelog survives monitoring failure', async ({page}) => {
  await page.route('https://status.test/**', route=>route.abort());
  await page.goto('/changelog');
  await expect(page.locator('.changelog-entry').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Failed to load');
});
test('documentation reviews are grouped by their type on the changelog and the directory', async ({page}) => {
  await page.route('https://status.test/**', route => route.abort());
  const changelog = JSON.parse(readFileSync('src/data/changelog.json', 'utf8'));
  const reviews = changelog.filter((e: {type: string}) => e.type === 'catalog_reviewed');
  expect(reviews.length).toBe(7);
  // No routine review is left typed as a model addition.
  expect(changelog.filter((e: {type: string; title: string}) => e.type === 'model_added' && /documentation/i.test(e.title))).toEqual([]);
  await page.goto('/changelog');
  await expect(page.locator('[data-chip="catalog_reviewed"]')).toContainText('Documentation review');
  await expect(page.locator('[data-chip="catalog_reviewed"] [data-chip-count]')).toHaveText(String(reviews.length));
  const group = page.locator('.changelog-entry[data-kind="catalog_reviewed"]');
  await expect(group).toHaveCount(1);
  await expect(group).toContainText(`Documentation reviewed for ${reviews.length} providers`);
  await expect(page.locator('.changelog-entry[data-kind="model_added"]').filter({ hasText: 'documentation refreshed' })).toHaveCount(0);
  await page.goto('/');
  const recent = page.locator('#recent-changes .chg[data-kind="catalog_reviewed"]');
  await expect(recent).toHaveCount(1);
  await expect(recent).toContainText(`Documentation reviewed for ${reviews.length} providers`);
});
test('live changelog entries are classified by type, with a narrow fallback for legacy review copies', async ({page}) => {
  const live = [
    // The type decides, whatever the title says.
    { id: 'r1', provider_id: 'groq', provider_name: 'Groq', date: '2026-11-20', type: 'catalog_reviewed', title: 'Groq limits re-checked' },
    { id: 'r2', provider_id: 'cohere', provider_name: 'Cohere', date: '2026-11-20', type: 'catalog_reviewed', title: 'Cohere limits re-checked' },
    { id: 'm1', provider_id: 'groq', provider_name: 'Groq', date: '2026-11-19', type: 'model_added', title: 'Groq documentation refreshed', description: 'Groq added free model X.' },
    // The checker keeps the old curated copy (model_added) until it is redeployed.
    { id: 'catalog-2026-11-16-groq', provider_id: 'groq', provider_name: 'Groq', date: '2026-11-16', type: 'model_added', title: 'Groq catalog and free-tier documentation refreshed' },
    // A type this build does not know renders as a generic change, as text.
    { id: 'u1', provider_id: 'groq', provider_name: 'Groq', date: '2026-11-18', type: '<b>new_kind</b>', title: 'Something new' },
  ];
  await page.route('https://status.test/**', route => new URL(route.request().url()).pathname === '/api/changelog'
    ? route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: live })
    : route.abort());
  await page.goto('/changelog');
  await expect(page.locator('[data-chip="catalog_reviewed"] [data-chip-count]')).toHaveText('3');
  await expect(page.locator('section[data-date="2026-11-20"] .changelog-entry[data-kind="catalog_reviewed"]')).toContainText('Documentation reviewed for 2 providers');
  await expect(page.locator('section[data-date="2026-11-16"] .changelog-entry[data-kind="catalog_reviewed"]')).toContainText('Documentation reviewed for');
  await expect(page.locator('section[data-date="2026-11-19"] .changelog-entry[data-kind="model_added"]')).toContainText('Groq documentation refreshed');
  const unknown = page.locator('section[data-date="2026-11-18"] .changelog-entry');
  await expect(unknown).toContainText('Something new');
  await expect(unknown.locator('.tag')).toHaveText('<b>new kind</b>');
  await expect(page.locator('main b')).toHaveCount(0);
  await page.goto('/');
  await expect(page.locator('#recent-changes .chg[data-kind="catalog_reviewed"]').first()).toContainText('Documentation reviewed for 2 providers');
  await expect(page.locator('#recent-changes .chg[data-kind="model_added"]')).toContainText('Groq documentation refreshed');
  await expect(page.locator('#recent-changes .chg').filter({ hasText: 'Something new' }).locator('.tag')).toHaveText('Update');
});
test('API key variable names come from the provider id in static mode', async ({page}) => {
  await page.route('https://status.test/**', route => route.abort());
  await page.goto('/providers/google-ai-studio');
  await expect(page.locator('#cf-env')).toHaveText('GOOGLE_AI_STUDIO_API_KEY');
  await page.goto('/configs');
  await expect(page.locator('#t-yaml')).toContainText('os.environ/GOOGLE_AI_STUDIO_API_KEY');
  await expect(page.locator('#t-yaml')).not.toContainText('os.environ/GOOGLE_API_KEY');
  await expect(page.locator('#k-google-ai-studio')).toHaveText('GOOGLE_AI_STUDIO_API_KEY');
});

test('mobile pages stay within the viewport and pricing sorts by keyboard', async ({page}, testInfo) => {
  await mock(page);
  await page.setViewportSize({width:390,height:844});
  for (const path of ['/', '/models', '/providers', '/providers/groq', '/providers/github-models', '/pricing', '/configs', '/changelog']) {
    await page.goto(path);
    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.page, `${path} should fit the mobile viewport`).toBeLessThanOrEqual(dimensions.viewport);
  }
  // "Not published" explanations open a tooltip that must stay inside the viewport too.
  await page.goto('/');
  const triggers = await page.locator('button.np:visible, button.dash:visible').all();
  expect(triggers.length).toBeGreaterThanOrEqual(1);
  for (const trigger of triggers) {
    await trigger.focus();
    await expect(page.locator('#tip')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'open tooltip should fit the mobile viewport').toBeLessThanOrEqual(390);
  }
  await page.goto('/pricing');
  await expect(page.locator('#pr-list [data-pr-row]:visible').first()).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('pricing-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/pricing');
  const output = page.locator('th[data-sort-key="output"]');
  await output.locator('button').focus();
  await page.keyboard.press('Enter');
  await expect(output).toHaveAttribute('aria-sort','ascending');
  await page.keyboard.press('Enter');
  await expect(output).toHaveAttribute('aria-sort','descending');
  await page.goto('/');
  await page.screenshot({path:testInfo.outputPath('dashboard-desktop.png'),fullPage:true});
});
