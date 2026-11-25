import { test,expect } from '@playwright/test';
const catalogAPI=`http://127.0.0.1:${process.env.CATALOG_TEST_PORT||'4334'}`;
test.beforeEach(async({request,page})=>{
  await request.post(`${catalogAPI}/test/state`,{data:{}});
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1')return route.continue();
    if(url.hostname!=='status.test')return route.abort();
    return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{
    last_checked:new Date().toISOString(),providers:[{id:'discovered-demo',status:'active',latency_ms:30,coverage:{total:2,checked:1,healthy:1}}],
    models:[{provider_id:'discovered-demo',model_id:'fresh-model',status:'active',latency_ms:30,checked_at:new Date().toISOString()}],
  }});});
});
test('pages render the live catalog served through the public DTO, not the bundled fallback',async({page})=>{
  const response=await page.goto('/providers/groq');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['x-catalog-revision']).toBe('revision-one');
  expect(response?.headers()['x-catalog-source']).toBe('live');
  await expect(page.getByText(/Live catalog is temporarily unavailable/)).toHaveCount(0);
});
test('the site Worker reads the catalog through its CHECKER service binding, not over HTTP',async({page,request})=>{
  expect((await page.goto('/'))?.headers()['x-catalog-source']).toBe('live');
  expect(await (await request.get(`${catalogAPI}/test/last-via`)).json()).toEqual({via:'checker-binding'});
});
test('new providers and their models appear without rebuilding the server',async({page,request},testInfo)=>{
  expect((await page.goto('/providers/discovered-demo'))?.status()).toBe(404);
  await request.post(`${catalogAPI}/test/state`,{data:{extra:true}});
  expect((await page.goto('/providers/discovered-demo'))?.status()).toBe(200);
  await expect(page.getByRole('heading',{name:'Discovered Demo free API',exact:true,level:1})).toBeVisible();
  // Model status comes only from the live status snapshot; each model row has one live dot per layout.
  const fresh=page.locator('.only-md [data-model-id="fresh-model"] .dot');
  await expect(fresh).toHaveClass(/d-active/);
  await expect(fresh).toHaveAttribute('title',/^Health: Operational/);
  const unobserved=page.locator('.only-md [data-model-id="unobserved-model"] .dot');
  await expect(unobserved).toHaveClass(/d-unknown/);
  await expect(unobserved).toHaveAttribute('title','Not checked recently');
  await expect(page.locator('[data-probe-coverage]')).toContainText('1 of 2');
  // Neither model publishes a context window: both say so instead of inventing one.
  await expect(page.locator('.only-md tbody button.dash[data-tip="No context window in the official catalog."]')).toHaveCount(2);
  await page.screenshot({path:testInfo.outputPath('provider-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:testInfo.outputPath('provider-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  // The old /providers URL is a real 301 in dynamic mode and keeps the query string.
  const redirect=await request.get('/providers?q=discovered',{maxRedirects:0});
  expect(redirect.status()).toBe(301);
  expect(redirect.headers()['location']).toMatch(/^(https?:\/\/[^/]+)?\/\?q=discovered$/);
  await page.goto('/providers?q=discovered');
  await expect(page.locator('#dir-q')).toHaveValue('discovered');
  await expect(page.locator('[data-pt-row][data-provider-id="discovered-demo"]:visible')).toBeVisible();
  await page.goto('/models?q=fresh-model');await expect(page.locator('.m-tbl').getByText('fresh-model',{exact:true})).toBeVisible();
  await page.goto('/configs');await expect(page.locator('body')).toContainText('discovered-demo');
  // The on-demand sitemap lists the live catalog with lastmod, and internal links use the canonical trailing-slash form.
  const sitemap=await (await request.get('/sitemap-providers.xml')).text();
  expect(sitemap).toContain('/providers/discovered-demo/</loc><lastmod>');
  await page.goto('/');
  await expect(page.locator('a[href="/providers/discovered-demo/"]').first()).toBeAttached();
  expect(await page.locator('a[href^="/providers/"]:not([href*="/providers/"][href$="/"]):not([href*="#"]):not([href*="?"])').count()).toBe(0);
  // Non-canonical '/x' 301s to '/x/' with the query string; file-like paths are left alone.
  for (const [from, to] of [['/models', '/models/'], ['/pricing?provider=groq', '/pricing/?provider=groq'], ['/providers/groq', '/providers/groq/']]) {
    const r=await request.get(from,{maxRedirects:0});
    expect(r.status()).toBe(301);
    expect(r.headers()['location']).toMatch(new RegExp(`^(https?://[^/]+)?${to.replace(/[?]/g,'\\?')}$`));
  }
  expect((await request.get('/data/status_summary.json',{maxRedirects:0})).headers()['x-robots-tag']).toBe('noindex');
  // Provider pages describe the provider as an Organization, never as a rating-less SoftwareApplication.
  await page.goto('/providers/groq/');
  const ld=await page.locator('script[type="application/ld+json"]').textContent();
  expect(ld).not.toContain('SoftwareApplication');
  expect(ld).toContain('"about":{"@type":"Organization"');
});
test('unavailable or malformed live catalogs show a labeled snapshot and do not invent new routes',async({page,request})=>{
  // Seed the site's last-known-good copy with a catalog that lacks discovered-demo.
  expect((await page.goto('/providers/groq'))?.headers()['x-catalog-source']).toBe('live');
  for(const mode of ['offline','malformed']){
    await request.post(`${catalogAPI}/test/state`,{data:{mode}});
    const response=await page.goto('/providers/groq');
    // The groq visit above seeded the last-known-good copy, so failures serve it as stale, not the snapshot.
    expect(response?.headers()['x-catalog-source']).toBe('stale');
    await expect(page.getByText(/Live catalog is temporarily unavailable/)).toBeVisible();
    expect((await page.goto('/providers/discovered-demo'))?.status()).toBe(503);
  }
});
test('removed providers disappear on the next request and unknown routes return 404',async({page,request})=>{
  await request.post(`${catalogAPI}/test/state`,{data:{extra:true}});
  expect((await page.goto('/providers/discovered-demo'))?.status()).toBe(200);
  await request.post(`${catalogAPI}/test/state`,{data:{}});
  expect((await page.goto('/providers/discovered-demo'))?.status()).toBe(404);
  // Unknown provider ids and unknown paths both get the site's 404 page: status 404, navigation, noindex.
  for (const path of ['/providers/discovered-demo/', '/no-such-page/']) {
    const res=await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading',{name:'Page not found',level:1})).toBeVisible();
    await expect(page.locator('#navbar a[href="/models/"]')).toBeAttached();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  }
});
test('the provider page and Tools name the API key variable from the public id, the same rule as static mode',async({page,request})=>{
  // Never the checker's secret binding name (api_key_env, e.g. GOOGLE_API_KEY): it is not in the public DTO.
  await page.goto('/providers/google-ai-studio');
  await expect(page.locator('#cf-env')).toHaveText('GOOGLE_AI_STUDIO_API_KEY');
  await page.goto('/configs');
  await expect(page.locator('#t-yaml')).toContainText('os.environ/GOOGLE_AI_STUDIO_API_KEY');
  await expect(page.locator('#t-yaml')).not.toContainText('os.environ/GOOGLE_API_KEY');
  // A provider that exists only in the live catalog gets its name from the same rule.
  await request.post(`${catalogAPI}/test/state`,{data:{extra:true}});
  await page.goto('/providers/discovered-demo');
  await expect(page.locator('#cf-env')).toHaveText('DISCOVERED_DEMO_API_KEY');
  await expect(page.locator('#quick-start')).toContainText('DISCOVERED_DEMO_API_KEY');
  await page.goto('/configs');
  await expect(page.locator('#t-yaml')).toContainText('os.environ/DISCOVERED_DEMO_API_KEY');
  await expect(page.locator('#k-discovered-demo')).toHaveText('DISCOVERED_DEMO_API_KEY');
  const feed=await request.get('/changelog.json');
  expect(feed.status()).toBe(200);
  expect(feed.headers()['content-type']).toContain('application/json');
  const entries=await feed.json();
  expect(Array.isArray(entries)&&entries.length>0).toBe(true);
  expect(entries.map((e:{date:string})=>e.date)).toEqual(entries.map((e:{date:string})=>e.date).sort().reverse());
});
