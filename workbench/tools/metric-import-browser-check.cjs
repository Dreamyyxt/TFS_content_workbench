// Isolated SDK fixtures and mocked provider responses. Never reads or writes live account data.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {mkdirSync,readFileSync}=require('node:fs');
const {join}=require('node:path');
const {fixture,prepare}=require('./studio-fixture.cjs');
const origin=process.env.STUDIO_URL||'http://127.0.0.1:4318';
const dir=process.env.STUDIO_ARTIFACT_DIR||'/private/tmp/tfs-metric-import';mkdirSync(dir,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
 await prepare(page,{origin,records:structuredClone(fixture),errors});
 let mode='success',held=null;
 const result={ok:true,fields:{platform:'小红书',video_url:'https://www.xiaohongshu.com/explore/abc',title:'秋日猫眼｜自然光下的细节',publish_date:'2026-10-17',likes:0,comments:12,saves:36},source:'红狐 MCP'};
 await page.route('**/api/metrics/import',async route=>{
  assert.equal(route.request().method(),'POST');
  if(mode==='hold'){held=route;return;}
  if(mode==='error')return route.fulfill({status:502,json:{ok:false,error:'测试：数据源暂不可用'}});
  await route.fulfill({json:result});
 });
 await page.locator('.tab[data-view="data"]').click();await page.locator('#btnToggleForm').click();
 await page.locator('#mUrl').fill('分享 https://xhslink.cn/o/abc 来看看');await page.locator('#btnImportMetric').click();
 await page.locator('#metricImportPreview').waitFor();
 assert.equal(await page.locator('#mTitle').inputValue(),'');assert.equal(await page.evaluate(()=>window.fixtureWrites||0),0);
 assert.ok((await page.locator('#metricImportStatus').textContent()).includes('分享'));
 await page.locator('#mF3').fill('53.5');await page.locator('#btnApplyMetricImport').click();
 assert.equal(await page.locator('#mTitle').inputValue(),result.fields.title);assert.equal(await page.locator('#mLikes').inputValue(),'0');
 assert.equal(await page.locator('#mShares').inputValue(),'');assert.equal(await page.locator('#mViews').inputValue(),'');assert.equal(await page.locator('#mImpr').inputValue(),'');assert.equal(await page.locator('#mF3').inputValue(),'53.5');
 assert.equal(await page.evaluate(()=>window.fixtureWrites||0),0);
 await page.locator('#btnImportMetric').click();await page.locator('#metricImportPreview').waitFor();
 await page.locator('#mUrl').fill('https://www.douyin.com/video/123');assert.equal(await page.locator('#metricImportPreview').isVisible(),false);
 mode='error';await page.locator('#btnImportMetric').click();await page.waitForFunction(()=>document.querySelector('#metricImportStatus').textContent.includes('数据源暂不可用'));
 assert.equal(await page.locator('#mTitle').inputValue(),result.fields.title);assert.equal(await page.locator('#btnImportMetric').isEnabled(),true);
 mode='hold';await page.locator('#btnImportMetric').click();await page.waitForFunction(()=>document.querySelector('#btnImportMetric').disabled);
 await page.locator('#btnCancelMetric').click();await page.locator('#btnToggleForm').click();await page.locator('#mTitle').fill('我正在填写的新记录');
 if(held)await held.fulfill({json:result}).catch(()=>{});
 await page.waitForTimeout(100);assert.equal(await page.locator('#metricImportPreview').isVisible(),false);assert.equal(await page.locator('#mTitle').inputValue(),'我正在填写的新记录');
 mode='success';await page.locator('#btnCancelMetric').click();await page.locator('[data-editmetric="v0"]').click();
 const previousViews=await page.locator('#mViews').inputValue();await page.locator('#mUrl').fill(result.fields.video_url);
 await page.locator('#btnImportMetric').click();await page.locator('#metricImportPreview').waitFor();await page.locator('#btnApplyMetricImport').click();
 assert.equal(await page.locator('#mViews').inputValue(),previousViews);await page.locator('#btnSaveMetric').click();await page.locator('#metricForm').waitFor({state:'hidden'});
 const saved=await page.evaluate(()=>window.fixture.video_metrics.find(x=>x.id==='v0'));assert.equal(saved.title,result.fields.title);assert.equal(saved.likes,0);assert.equal(saved.views,Number(previousViews));assert.equal(saved.finish_3s,30);
 for(const width of [1500,1080,768,390,360]){
  await page.setViewportSize({width,height:1100});
  const centers=await page.evaluate(()=>{const a=document.querySelector('.brand-logo').getBoundingClientRect(),b=document.querySelector('.brand-text').getBoundingClientRect();return [a.x+a.width/2,b.x+b.width/2];});
  assert.ok(Math.abs(centers[0]-centers[1])<1,`brand misalignment at ${width}`);
  if(await page.locator('#metricForm').isHidden())await page.locator('#btnToggleForm').click();
  await page.locator('#mUrl').fill(result.fields.video_url);await page.locator('#btnImportMetric').click();await page.locator('#metricImportPreview').waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,`overflow at ${width}`);
  await page.locator('.metric-import').screenshot({path:join(dir,`import-${width}.png`),animations:'disabled'});
 }
 // Test-only bridge inside the app closure; production assets are unchanged.
 const source=readFileSync(require.resolve('../app.js'),'utf8');
 const bridge="window.__scheduleCheck=()=>{document.querySelector('#schedStart').value='2026-10-17';document.querySelector('#schedWeeks').value='3';const r=autoSchedule();S.schedules=r.rows;S.scheduleMode='shoot';S.scheduleDay='2026-10-20';renderSchedule();renderBadges();document.querySelector('#scheduleGenerator').open=true;return r.rows;};";
 await page.route('**/app.js',route=>route.fulfill({contentType:'application/javascript',body:source.replace(/\}\)\(\);\s*$/,bridge+'})();')}));
 await page.reload();await page.locator('#syncState.is-ok').waitFor();
 await page.setViewportSize({width:1500,height:1100});await page.locator('.tab[data-view="schedule"]').click();
 const rows=await page.evaluate(()=>window.__scheduleCheck());
 assert.ok(rows.length);assert.ok(rows.every(r=>r.shoot_date>='2026-10-17'&&r.publish_at.slice(0,10)>r.shoot_date));
 await page.screenshot({path:join(dir,'schedule.png'),fullPage:true,animations:'disabled'});
 assert.deepEqual(errors,[]);console.log('PASS: logo centered at 5 widths; import preview, partial fields, explicit save, error/retry and stale cancellation; Oct 17 schedule regression.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
