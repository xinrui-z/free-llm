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
test('new providers and their models appear without rebuilding the server',async({page,request},testInfo)=>{
  expect((await page.goto('/providers/discovered-demo'))?.status()).toBe(404);
  await request.post(`${catalogAPI}/test/state`,{data:{extra:true}});
  expect((await page.goto('/providers/discovered-demo'))?.status()).toBe(200);
  await expect(page.getByRole('heading',{name:'Discovered Demo',exact:true})).toBeVisible();
  await expect(page.locator('[data-model-id="fresh-model"]')).toHaveText('active');
  await expect(page.locator('[data-model-id="unobserved-model"]')).toHaveText('unknown');
  await expect(page.locator('[data-probe-coverage]')).toContainText('1 of 2');
  await expect(page.getByText('Context: Not published',{exact:true})).toHaveCount(2);
  await page.screenshot({path:testInfo.outputPath('provider-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:testInfo.outputPath('provider-mobile.png'),fullPage:true});
  await page.goto('/providers?q=discovered');
  await expect(page.locator('[data-provider-id="discovered-demo"]')).toBeVisible();
  await page.goto('/models');await expect(page.getByText('fresh-model',{exact:true})).toBeVisible();
  await page.goto('/configs');await expect(page.locator('body')).toContainText('discovered-demo');
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
});
