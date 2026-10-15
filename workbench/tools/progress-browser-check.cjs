// Isolated data only; cloud writes are forbidden during this acceptance check.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {mkdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {join}=require('node:path');
const {fixture,prepare}=require('./studio-fixture.cjs');
const flow=require('../studio-workflow.js');
const origin=process.env.STUDIO_URL||'http://127.0.0.1:4318';
const dir=process.env.STUDIO_ARTIFACT_DIR||'/private/tmp/tfs-progress';
const baseline=process.env.STUDIO_BASELINE||'6d45b0e';
mkdirSync(dir,{recursive:true});
const records=structuredClone(fixture),today=flow.dayKey(),future=flow.shiftDay(today,1),past=flow.shiftDay(today,-1);
records.materials.forEach(row=>row.selected=true);
records.scripts.push({id:102,material_id:2,title:'正文待补的脚本',account:'小红书官方号',content:''});
records.schedules[0].publish_at=past+'T12:00:00+08:00';
records.video_metrics[0].schedule_id='p0';
records.schedules.push(
 {id:201,plan_batch:'p1',material_id:3,account:'老板IP号',title:'拍摄日期还没填',publish_at:future+'T12:00:00+08:00'},
 {id:202,plan_batch:'p1',material_id:4,account:'店铺日常号',title:'发布日期还没填',shoot_date:future},
 {id:203,plan_batch:'p1',script_id:101,material_id:1,account:'抖音官方号',title:'昨天的发布待核对',publish_at:past+'T14:00:00+08:00',shoot_date:past},
 {id:204,plan_batch:'p1',account:'抖音官方号',title:'已标记发布但没数据',status:'published'},
 {id:205,plan_batch:'p1',script_id:999,account:'抖音官方号',title:'原脚本已删除',publish_at:future+'T15:00:00+08:00',shoot_date:today},
 {id:206,plan_batch:'old',title:'旧批次不会混入',publish_at:past+'T14:00:00+08:00'});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const errors=[];
 if(process.env.STUDIO_CAPTURE_BEFORE==='1'){
  const page=await browser.newPage({viewport:{width:1600,height:1100}});await prepare(page,{origin,records,errors});
  for(const name of ['app.js','studio.css','studio-workflow.js'])await page.route('**/'+name,route=>route.fulfill({contentType:name.endsWith('.css')?'text/css':'application/javascript',body:execFileSync('git',['show',baseline+':workbench/'+name],{encoding:'utf8'})}));
  await page.route(origin+'/',route=>route.fulfill({contentType:'text/html',body:execFileSync('git',['show',baseline+':workbench/index.html'],{encoding:'utf8'})}));
  await page.reload();await page.locator('#syncState.is-ok').waitFor();await page.locator('.tab[data-view="progress"]').click();await page.screenshot({path:join(dir,'before.png'),animations:'disabled'});await page.close();
 }
 const page=await browser.newPage({viewport:{width:1600,height:1100},timezoneId:'America/Los_Angeles'});await prepare(page,{origin,records,errors});
 const open=()=>page.locator('.tab[data-view="progress"]').click();await open();
 const ids=()=>page.locator('#progressTasks [data-progress-item]').evaluateAll(nodes=>nodes.map(el=>el.dataset.progressItem));
 assert.equal(await page.locator('[data-progress-queue="pending"] strong').textContent(),'7');
 assert.equal(await page.locator('[data-progress-queue="dates"] strong').textContent(),'2');
 assert.equal(await page.locator('[data-progress-queue="review"] strong').textContent(),'2');
 assert.equal((await ids()).length,6);await page.screenshot({path:join(dir,'progress.png'),animations:'disabled'});
 await page.locator('#progressMore').click();assert.equal((await ids()).length,7);assert.equal(await page.locator('#progressMore').isVisible(),false);
 assert.equal(await page.locator('#progressTaskCount').evaluate(el=>el===document.activeElement),true);
 await page.locator('[data-progress-item="2"] [data-open-script]').click();assert.match(await page.locator('#modalTitle').textContent(),/正文待补/);await page.keyboard.press('Escape');
 assert.equal(await page.locator('[data-progress-item="2"] [data-open-script]').evaluate(el=>el===document.activeElement),true);
 await page.locator('[data-progress-item="3"] [data-focus-material]').click();await page.waitForFunction(()=>document.activeElement?.dataset.pendingId==='3');await open();
 await page.locator('[data-progress-queue="dates"]').click();assert.deepEqual((await ids()).sort(),['201','202']);
 assert.equal(await page.locator('[data-progress-queue="dates"]').evaluate(el=>el===document.activeElement),true);
 await page.locator('[data-progress-plan="201"]').click();await page.waitForFunction(()=>document.activeElement?.dataset.planId==='201');
 assert.equal(await page.locator('#scheduleBoard').getAttribute('data-mode'),'shoot');assert.equal(await page.locator('#scheduleUndated [data-plan-id="201"]').isVisible(),true);
 await open();await page.locator('[data-progress-plan="202"]').click();await page.waitForFunction(()=>document.activeElement?.dataset.planId==='202');assert.equal(await page.locator('#scheduleBoard').getAttribute('data-mode'),'publish');
 await open();await page.locator('[data-progress-queue="review"]').click();assert.deepEqual(await ids(),['203','204']);
 assert.match(await page.locator('#progressQueueHint').textContent(),/确认实际发布/);
 await page.locator('#progressTasks [data-record-schedule="203"]').click();assert.equal(await page.locator('#mSchedule').inputValue(),'203');assert.equal(await page.locator('#mTitle').inputValue(),'昨天的发布待核对');await page.locator('#btnCancelMetric').click();await open();
 assert.equal(await page.locator('#progressFunnel .progress-stage').count(),5);assert.doesNotMatch(await page.locator('#progressFunnel').textContent(),/\d+%/);
 assert.equal(await page.locator('#progressKpis .kpi').nth(1).locator('.k-value').textContent(),'7');
 assert.match(await page.locator('#progressKpis').textContent(),/已录入数据/);assert.doesNotMatch(await page.locator('#progressShoot').textContent(),/上午/);
 assert.match(await page.locator('#progressUpcoming .up-row').filter({hasText:'原脚本已删除'}).textContent(),/脚本待补/);
 await page.locator('#progressFunnel').evaluate(el=>el.closest('.panel').scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:join(dir,'stages.png'),animations:'disabled'});
 await page.locator('#progressFunnel [data-route="data"]').click();assert.equal(await page.locator('#view-data').isVisible(),true);await open();
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.getElementById('motionToggle').disabled);
 await page.locator('[data-progress-queue="dates"]').click();assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
 for(const width of [1440,1200,1024,768,600,390,320]){
  await page.setViewportSize({width,height:950});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow at '+width);
  if(width===390){await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:join(dir,'mobile.png'),animations:'disabled'});}
 }
 assert.equal(await page.evaluate(()=>window.fixtureWrites||0),0);await page.close();
 const empty=await browser.newPage();await prepare(empty,{origin,records:{...records,materials:[],scripts:[],schedules:[],video_metrics:[]},errors});await empty.locator('.tab[data-view="progress"]').click();
 for(const key of ['pending','dates','review']){await empty.locator('[data-progress-queue="'+key+'"]').click();assert.equal(await empty.locator('.progress-task-empty').isVisible(),true);assert.equal(await empty.locator('#progressMore').isVisible(),false);}
 await empty.close();assert.deepEqual(errors,[]);
 console.log('PASS: actual queue counts, pagination/focus, empty scripts, topic handoff, undated planner focus in both modes, publication review form, no inferred completion/conversion, missing script checks, empty states, 7 widths, reduced motion and zero cloud writes.');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
