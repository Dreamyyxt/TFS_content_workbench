// All records and cloud requests are isolated; this check never writes production data.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {mkdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {join}=require('node:path');
const {fixture,prepare}=require('./studio-fixture.cjs');
const flow=require('../studio-workflow.js');
const origin=process.env.STUDIO_URL||'http://127.0.0.1:4318';
const dir=process.env.STUDIO_ARTIFACT_DIR||'/private/tmp/tfs-analytics';
const baseline=process.env.STUDIO_BASELINE||'507139a';
mkdirSync(dir,{recursive:true});
const records=structuredClone(fixture),today=flow.dayKey();
records.video_metrics.forEach((row,index)=>{row.publish_date=flow.shiftDay(today,-6+Math.floor(index/2));});
records.video_metrics[13].schedule_id='p0';records.video_metrics[13].finish_3s=75;records.video_metrics[13].note='换封面后观察';
records.video_metrics.push({id:'missing',title:'还没填写发布日期',account:'历史账号',views:0,finish_3s:null},
 {id:'invalid',title:'日期需要补全',account:'历史账号',publish_date:'2026-02-30',views:null},
 {id:'old',title:'上月作品',account:'抖音官方号',publish_date:flow.shiftDay(today,-29),views:100,finish_3s:10},
 {id:'future',title:'误填未来日期的记录',account:'抖音官方号',publish_date:flow.shiftDay(today,1),views:20});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const errors=[];
 if(process.env.STUDIO_CAPTURE_BEFORE==='1'){
  const page=await browser.newPage({viewport:{width:1600,height:1100}});await prepare(page,{origin,records,errors});
  for(const name of ['app.js','studio.css','studio-workflow.js']){
   await page.route('**/'+name,route=>route.fulfill({contentType:name.endsWith('.css')?'text/css':'application/javascript',body:execFileSync('git',['show',baseline+':workbench/'+name],{encoding:'utf8'})}));
  }
  await page.route(origin+'/',route=>route.fulfill({contentType:'text/html',body:execFileSync('git',['show',baseline+':workbench/index.html'],{encoding:'utf8'})}));
  await page.reload();await page.locator('#syncState.is-ok').waitFor();await page.locator('.tab[data-view="data"]').click();await page.screenshot({path:join(dir,'before.png'),animations:'disabled'});await page.close();
 }
 const page=await browser.newPage({viewport:{width:1600,height:1100}});await prepare(page,{origin,records,errors});
 await page.locator('.tab[data-view="data"]').click();
 const ids=()=>page.locator('#dataTable tbody tr').evaluateAll(rows=>rows.map(row=>row.dataset.metricId));
 assert.equal((await ids()).length,18);assert.equal(await page.locator('.chart-column').count(),7);
 await page.screenshot({path:join(dir,'dashboard.png'),animations:'disabled'});
 await page.locator('[data-data-period="7"]').click();assert.equal((await ids()).length,14);
 assert.equal(await page.locator('#dataKpis .kpi .k-value').first().textContent(),'14');
 assert.match(await page.locator('#dataScope').textContent(),new RegExp(flow.shiftDay(today,-6)));
 await page.locator('#dataFilter').selectOption('小红书官方号');assert.equal((await ids()).length,7);
 await page.locator('#dataSearch').fill('换封面');assert.deepEqual(await ids(),['v13']);
 assert.equal(await page.locator('#dataKpis .kpi .k-value').first().textContent(),'1');assert.equal(await page.locator('.chart-column').count(),1);
 assert.equal(await page.locator('.ring-copy strong').textContent(),'75.0%');assert.equal(await page.locator('#dataRank .rank-row').count(),1);
 await page.locator('#dataRank [data-open-script]').click();assert.match(await page.locator('#modalBody').textContent(),/琥珀猫眼/);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#dataRank [data-open-script]').evaluate(el=>el===document.activeElement),true);
 await page.locator('#dataRank [data-focus-material]').click();assert.equal(await page.locator('#view-scripts').isVisible(),true);
 await page.waitForFunction(()=>document.activeElement?.dataset.pendingId==='1');
 await page.locator('.tab[data-view="data"]').click();await page.locator('#dataSort').selectOption('views');
 await page.locator('#dataSearch').fill('不存在的标题');assert.equal((await ids()).length,0);
 assert.equal(await page.locator('.ring-copy strong').textContent(),'—');assert.equal(await page.locator('.chart-column').count(),0);
 await page.locator('[data-clear-data-filters]').click();assert.equal((await ids()).length,18);
 assert.equal(await page.locator('#dataSort').inputValue(),'views');assert.equal(await page.locator('#dataSearch').evaluate(el=>el===document.activeElement),true);
 assert.equal((await ids())[0],'v13');assert.equal((await ids()).at(-1),'invalid');
 await page.locator('[data-data-period="30"]').click();assert.equal((await ids()).length,15);
 await page.locator('[data-data-period="undated"]').click();assert.deepEqual(await ids(),['missing','invalid']);
 assert.equal(await page.locator('.chart-column').count(),0);assert.equal(await page.locator('.ring-copy strong').textContent(),'—');
 await page.locator('#dataFilter').selectOption('历史账号');assert.deepEqual(await ids(),['missing','invalid']);
 await page.locator('#dataClear').click();await page.locator('#dataSort').selectOption('retention');assert.equal((await ids())[0],'v13');
 // String record IDs must still open the existing record rather than a blank form.
 await page.locator('[data-editmetric="v13"]').click();assert.equal(await page.locator('#mTitle').inputValue(),records.video_metrics[13].title);
 assert.equal(await page.locator('#mTitle').evaluate(el=>el===document.activeElement),true);
 await page.locator('#btnCancelMetric').click();await page.locator('[data-delmetric="v13"]').click();
 assert.match(await page.locator('.confirm-bar').textContent(),/秋日美甲作品 14/);await page.locator('.confirm-bar [data-no]').click();assert.equal((await ids()).length,18);
 await page.locator('#dataRank').evaluate(el=>el.closest('.panel').scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:join(dir,'sources.png'),animations:'disabled'});
 assert.equal(await page.evaluate(()=>window.fixtureWrites||0),0);
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.getElementById('motionToggle').disabled);
 await page.locator('[data-data-period="7"]').click();assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
 for(const width of [1440,1200,1024,768,600,390,320]){
  await page.setViewportSize({width,height:950});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow at '+width);
  if(width===390){await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:join(dir,'mobile.png'),animations:'disabled'});}
 }
 await page.locator('#dataTable').focus();await page.keyboard.press('ArrowRight');
 await page.waitForFunction(()=>document.getElementById('dataTable').scrollLeft>0);
 assert.deepEqual(errors,[]);await page.close();
 console.log('PASS: analytics periods, consistent KPI/chart/rank scope, composed search/account filters, missing dates, historical accounts, sorting/reset, explicit source handoff, string record editing, delete cancellation, keyboard table scrolling, reduced motion, 7 widths, zero cloud writes.');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
