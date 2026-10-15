const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {mkdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {join}=require('node:path');
const {fixture,prepare}=require('./studio-fixture.cjs');
const flow=require('../studio-workflow.js');
const origin=process.env.STUDIO_URL||'http://127.0.0.1:4318';
const dir=process.env.STUDIO_ARTIFACT_DIR||'/private/tmp/tfs-topic-library';
const baseline=process.env.STUDIO_BASELINE||'456069c';
mkdirSync(dir,{recursive:true});
const records=structuredClone(fixture);
records.materials.forEach((row,index)=>row.content_form=['实拍','口播','图文'][index%3]);
records.materials.push({id:99,account:'历史账号',batch_id:'old-batch',title:'历史选题：安静的门店日常',selected:false,content_form:'随手拍',hook:'收店前，留住这一天的光。'});
records.scripts.push({id:102,material_id:'2',title:'法式脚本',account:'小红书官方号',content:'0–3秒：特写法式指尖。'},
 {id:103,material_id:5,title:'未勾选选题已有脚本',account:'抖音官方号',content:'0–3秒：记录阳光。'});
records.schedules.push({id:'old-topic-plan',plan_batch:'p1',material_id:99,account:'历史账号',title:'历史选题：安静的门店日常',publish_at:flow.dayKey()+'T10:00:00+08:00'});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const errors=[];
 if(process.env.STUDIO_CAPTURE_BEFORE==='1'){
  const before=await browser.newPage({viewport:{width:1600,height:1050}});await prepare(before,{origin,records,errors});
  for(const name of ['app.js','studio.css','studio-workflow.js']){
   const source=execFileSync('git',['show',baseline+':workbench/'+name],{encoding:'utf8'});
   await before.route('**/'+name,route=>route.fulfill({contentType:name.endsWith('.css')?'text/css':'application/javascript',body:source}));
  }
  await before.route(origin+'/',route=>route.fulfill({contentType:'text/html',body:execFileSync('git',['show',baseline+':workbench/index.html'],{encoding:'utf8'})}));
  await before.reload();await before.locator('#syncState.is-ok').waitFor();await before.locator('.tab[data-view="materials"]').click();
  await before.locator('#accountFilter').evaluate(el=>el.closest('.filterbar').scrollIntoView({block:'start',behavior:'instant'}));
  await before.screenshot({path:join(dir,'before.png'),animations:'disabled'});await before.close();
 }
 const page=await browser.newPage({viewport:{width:1600,height:1050}});await prepare(page,{origin,records,errors});
 await page.locator('.tab[data-view="materials"]').click();
 const ids=()=>page.locator('#materialGrid .card').evaluateAll(nodes=>nodes.map(el=>Number(el.dataset.materialId)));
 assert.equal((await ids()).length,8);assert.match(await page.locator('#materialResultCount').textContent(),/8 \/ 8/);
 await page.locator('.topic-library-controls').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
 await page.screenshot({path:join(dir,'topics.png'),animations:'disabled'});
 await page.locator('#materialStatus').selectOption('written');assert.deepEqual(await ids(),[1,2,5]);
 await page.locator('#materialForm').selectOption('口播');assert.deepEqual(await ids(),[2,5]);
 await page.locator('[data-acc="小红书官方号"]').click();await page.locator('#selectedOnly').click();
 await page.locator('#materialSearch').fill('换季配色');assert.deepEqual(await ids(),[2]);
 await page.locator('#materialSearch').fill('不存在的词');assert.equal(await page.locator('#materialEmpty').isVisible(),true);
 await page.locator('#materialEmpty [data-clear-material-filters]').click();assert.equal((await ids()).length,8);
 assert.equal(await page.locator('#onlyLatest').isChecked(),true);assert.equal(await page.locator('#materialStatus').inputValue(),'all');
 assert.equal(await page.locator('#materialForm').inputValue(),'全部');assert.equal(await page.locator('#selectedOnly').getAttribute('aria-pressed'),'false');
 assert.equal(await page.locator('#materialSearch').evaluate(el=>el===document.activeElement),true);
 await page.locator('[data-material-id="5"] [data-open-script]').click();assert.match(await page.locator('#modalBody').textContent(),/记录阳光/);
 await page.keyboard.press('Escape');assert.equal(await page.locator('[data-material-id="5"] [data-open-script]').evaluate(el=>el===document.activeElement),true);
 assert.equal(await page.locator('[data-pick="5"]').getAttribute('aria-pressed'),'false');
 await page.locator('[data-material-id="1"] .topic-details summary').click();
 assert.match(await page.locator('[data-material-id="1"] .topic-details-body').textContent(),/让款式自己说话/);
 await page.locator('[data-material-id="1"] [data-del]').click();await page.locator('.confirm-bar [data-no]').click();assert.equal((await ids()).length,8);
 await page.locator('#onlyLatest').uncheck();assert.equal((await ids()).length,9);
 assert.match(await page.locator('[data-acc="历史账号"]').textContent(),/1/);
 await page.locator('[data-acc="历史账号"]').click();assert.deepEqual(await ids(),[99]);
 await page.locator('#materialForm').selectOption('实拍');assert.equal((await ids()).length,0);
 await page.locator('#materialClear').click();assert.equal((await ids()).length,9);assert.equal(await page.locator('#onlyLatest').isChecked(),false);
 // Existing calendar handoff clears the new filters too, without selecting or generating.
 await page.locator('#materialForm').selectOption('实拍');await page.locator('#materialStatus').selectOption('written');
 await page.locator('.tab[data-view="home"]').click();await page.locator('#homeDayItems [data-focus-material="99"]').click();
 await page.waitForFunction(()=>document.activeElement?.dataset.materialId==='99');
 assert.equal(await page.locator('#materialForm').inputValue(),'全部');assert.equal(await page.locator('#materialStatus').inputValue(),'all');
 assert.equal(await page.locator('[data-pick="99"]').getAttribute('aria-pressed'),'false');
 assert.equal(await page.evaluate(()=>window.fixtureWrites||0),0);
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.getElementById('motionToggle').disabled);
 await page.locator('#materialStatus').selectOption('unwritten');assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
 await page.close();
 const mobile=await browser.newPage();await prepare(mobile,{origin,records,errors});await mobile.locator('.tab[data-view="materials"]').click();
 for(const width of [1440,1200,1024,768,600,390,320]){
  await mobile.setViewportSize({width,height:950});assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow at '+width);
  if(width===390){await mobile.locator('.topic-library-controls').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await mobile.screenshot({path:join(dir,'mobile.png'),animations:'disabled'});}
 }
 await mobile.locator('[data-material-id="1"] .topic-details summary').click();
 assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'expanded detail overflow');
 await mobile.close();assert.deepEqual(errors,[]);
 console.log('PASS: form/status/account/search/selected filters, ID-compatible script links, reset preserves batch scope, historical accounts, direct script and return focus, delete cancellation, calendar handoff clears filters, reduced motion, 7 widths and zero cloud writes.');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
