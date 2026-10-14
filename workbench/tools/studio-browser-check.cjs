// Isolated UI acceptance: all cloud calls are stubbed, production records are never used.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const origin=process.env.STUDIO_URL || 'http://127.0.0.1:4318';
const artifactDir=process.env.STUDIO_ARTIFACT_DIR || '/private/tmp/tfs-studio-check';
mkdirSync(artifactDir,{recursive:true});
const fixture={
 materials:Array.from({length:8},(_,i)=>({id:i+1,account:['抖音官方号','小红书官方号','老板IP号','店铺日常号'][i%4],title:['秋日指尖，留一点温柔的琥珀色','短甲也能拥有的法式松弛感','开店十二年，我坚持的小事','收店前的十分钟，治愈一天'][i%4],batch_id:'batch-1',selected:i<3,content_form:'实拍',goal:'收藏',angle:'让款式自己说话',hook:'阳光照在指尖上的这一刻，刚刚好。',keywords:'秋冬美甲,猫眼,静安区美甲',trend_reason:'以真实作品细节回应换季配色需求。',priority:i===0?'high':'normal'})),
 scripts:[{id:101,material_id:1,account:'抖音官方号',title:'秋日指尖，留一点温柔的琥珀色',content:'## 拍摄脚本\n\n0–3秒：展示琥珀猫眼在日光下的光泽。\n3–12秒：转换角度，展示甲型与细节。',created_at:'2026-10-13T02:00:00Z'}],
 schedules:[{id:'p0',script_id:101,material_id:1,account:'抖音官方号',title:'秋日指尖，留一点温柔的琥珀色',plan_batch:'p1',publish_at:'2026-10-14T18:30:00+08:00',publish_slot:'18:30',shoot_date:'2026-10-13',status:'planned'}],
 video_metrics:Array.from({length:14},(_,i)=>({id:'v'+i,account:i%2?'小红书官方号':'抖音官方号',title:'秋日美甲作品 '+(i+1),platform:i%2?'小红书':'抖音',publish_date:'2026-10-'+String(7+Math.floor(i/2)).padStart(2,'0'),views:700+i*193,finish_3s:i%2?60:30,finish_5s:28,likes:80+i*5,comments:12,saves:50,shares:8,groupon_redeemed:2})),
 trend_snapshots:[{id:'t0',source:'seed',summary:'让温暖的棕色、琥珀与微光走进秋日。用真实上手效果和款式细节，回应顾客的换季需求。',keywords:'秋冬美甲,琥珀猫眼,静安区美甲',created_at:'2026-10-13T02:00:00Z',payload:{}}],store_profile:[]
};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 const errors=[];
 async function prepare(target,records=fixture){
 const page=target;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*', async route=>{
  const url=route.request().url();
  if(url.includes('cdn.jsdelivr.net')) return route.fulfill({contentType:'application/javascript',body:`window.WorkBuddyCloud={createWorkBuddyCloud:()=>({database:{from:table=>{let rows=window.fixture[table]||[];let patch=null;const q={select(){return q},order(){return q},limit(){return q},eq(key,value){rows=rows.filter(r=>r[key]===value);return q},update(p){patch=p;return q},then(resolve,reject){return (async()=>{if(patch){const control=window.fixtureControl||{};if(table==='materials'){control.calls=(control.calls||0)+1;if(control.delay)await new Promise(r=>setTimeout(r,control.delay));if(control.throwIds?.some(id=>rows.some(r=>r.id===id)))throw new Error('Simulated transport failure');if(control.failIds?.some(id=>rows.some(r=>r.id===id)))return {data:[],error:{message:'Simulated SDK failure'}};if(control.emptyIds?.some(id=>rows.some(r=>r.id===id)))return {data:[],error:null};}rows.forEach(r=>Object.assign(r,patch));}return {data:rows,error:null}})().then(resolve,reject)}};return q}},llm:{models:{list:async()=>[{id:'test-model',name:'测试模型',maxInputTokens:1000,maxOutputTokens:1000}]}}})};`});
  if(url.startsWith(origin+'/'))return route.continue();
  return route.abort();
 });
 await page.addInitScript(f=>{window.fixture=f},records);
 await page.goto(origin);
 await page.locator('#syncState.is-ok').waitFor({timeout:10000});
 }
 await prepare(page);
 assert.equal(await page.locator('#homeMaterialCount').textContent(),'8');
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:join(artifactDir,'home.png'),fullPage:true,animations:"disabled"});
 await page.locator('.node-top-left').click();
 await page.locator('#materialSearch').fill('琥珀');
 assert.equal(await page.locator('#materialGrid .card').count(),2);
 await page.locator('#materialSearch').fill('不存在的选题');
 assert.equal(await page.locator('#materialEmpty').isVisible(),true);
 await page.locator('#materialSearch').fill('');
 await page.locator('[data-pick="4"]').click();
 assert.equal(await page.locator('[data-pick="4"]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#basketCount').textContent(),'4');
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:join(artifactDir,'materials.png'),fullPage:true,animations:"disabled"});
 await page.locator('[data-pick="4"]').click();
 await page.locator('.tab[data-view="home"]').click();
 await page.locator('#homeNext [data-makevideo="101"]').click();
 assert.equal(await page.locator('#view-video').isVisible(),true);
 assert.equal(await page.locator('#jyTitle').inputValue(),fixture.scripts[0].title);
 await page.locator('#jyModeGenerate').click();
 assert.equal(await page.locator('#jyScript').getAttribute('required'),'');
 assert.match(await page.locator('#jyAssetsHeading').textContent(),/可选/);
 await page.locator('#jyModeEdit').click();
 await page.locator('.tab[data-view="data"]').click();
 assert.equal(await page.locator('.chart-column').count(),7);
 await page.locator('#dataFilter').selectOption('小红书官方号');
 assert.match(await page.locator('.ring-copy strong').textContent(),/60/);
 assert.equal(await page.locator('#dataTable tbody tr').count(),7);
 assert.equal(await page.locator('#dataKpis .kpi').first().locator('.k-value').textContent(),'7');
 assert.doesNotMatch(await page.locator('#dataRank').textContent(),/抖音官方号/);
 await page.locator('#dataFilter').selectOption('全部');
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:join(artifactDir,'data.png'),fullPage:true,animations:"disabled"});
 await page.locator('#btnToggleForm').click();assert.equal(await page.locator('#metricForm').isVisible(),true);await page.locator('#btnCancelMetric').click();
 await page.locator('#dataFilter').selectOption('老板IP号');
 assert.equal(await page.locator('.chart-column').count(),0);assert.equal(await page.locator('.ring-copy strong').textContent(),'—');
 const views=['home','materials','scripts','video','schedule','progress','data','profile','admin'];
 for(const width of [1440,1024,768,390,320]){
  await page.setViewportSize({width,height:900});
  for(const view of views){
   await page.locator('.tab[data-view="'+view+'"]').click();
   assert.equal(await page.locator('#view-'+view).isVisible(),true);
   const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
   if(overflow.scroll>overflow.width) console.log(await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(el=>el.getBoundingClientRect().right>innerWidth+1 && getComputedStyle(el).position!=='fixed').map(el=>({tag:el.tagName,cls:el.className,id:el.id,right:el.getBoundingClientRect().right})).slice(-20)));
   assert.ok(overflow.scroll<=overflow.width,view+' overflow at '+width+': '+overflow.scroll);
  }
 }
 await page.setViewportSize({width:390,height:844});await page.locator('.tab[data-view="home"]').click();await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:join(artifactDir,'mobile.png'),fullPage:true,animations:"disabled"});
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.core-orb').evaluate(el=>getComputedStyle(el).animationName),'none');
 // Interrupt running chart animations: data stays final and reduced motion stops all effects.
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('.tab[data-view="data"]').click();
 await page.locator('#dataFilter').selectOption('全部');
 await page.waitForFunction(()=>document.querySelector('.chart-bar').getAnimations().some(a=>a.playState==='running'));
 assert.equal(await page.locator('.ring-copy strong').textContent(),'45.0%');
 await page.locator('#motionToggle').click();
 assert.equal(await page.locator('body').getAttribute('data-motion'),'off');
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
 assert.equal(await page.locator('.ring-copy strong').textContent(),'45.0%');
 await page.reload();
 await page.locator('#syncState.is-ok').waitFor();
 assert.equal(await page.locator('#motionToggle').getAttribute('aria-pressed'),'false');
 assert.equal(await page.locator('.core-orb').evaluate(el=>getComputedStyle(el).animationName),'none');
 await page.locator('#motionToggle').click();
 // Keyboard focus highlights the matching link, just like mouse hover.
 await page.locator('.node-top-left').focus();
 assert.equal(await page.locator('[data-network-route="materials"].is-linked').count(),2);
 await page.locator('.node-top-right').focus();
 assert.equal(await page.locator('[data-network-route="materials"].is-linked').count(),0);
 assert.equal(await page.locator('[data-network-route="scripts"].is-linked').count(),2);
 await page.locator('.tab[data-view="data"]').click();
 await page.waitForFunction(()=>document.querySelector('.chart-bar').getAnimations().some(a=>a.playState==='running'));
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>document.getElementById('motionToggle').disabled);
 assert.equal(await page.locator('#motionToggle').isDisabled(),true);
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
 assert.equal(await page.locator('.ring-copy strong').textContent(),'45.0%');
 await page.emulateMedia({reducedMotion:'no-preference'});
 for (const view of ['home','data','home','scripts','data','video']) await page.locator('.tab[data-view="'+view+'"]').click();
 assert.equal(await page.locator('.view.is-active').count(),1);
 assert.equal(await page.locator('body').getAttribute('data-active-view'),'video');
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running' && a.effect?.target?.closest('.view:not(.is-active)')).length),0);
 await page.locator('#jyModeGenerate').click();
 assert.equal(await page.locator('#jyModeGenerate').getAttribute('aria-pressed'),'true');
 await page.locator('#jyModeEdit').click();
 assert.equal(await page.locator('#jyModeEdit').getAttribute('aria-pressed'),'true');
 // Selection updates one card in place and reports only saved selections.
 await page.locator('.tab[data-view="materials"]').click();
 await page.locator('#materialSearch').fill('');
 await page.evaluate(()=>{window.fixtureControl={delay:250,calls:0};window.savedPick=document.querySelector('[data-pick="4"]');window.neighbor=document.querySelector('[data-material-id="3"]')});
 await page.locator('[data-pick="4"]').focus();
 const pendingSelection=await page.evaluate(()=>{
  savedPick.click();savedPick.click();
  return {disabled:savedPick.getAttribute('aria-disabled'),selected:savedPick.getAttribute('aria-pressed'),count:document.getElementById('basketCount').textContent};
 });
 assert.equal(pendingSelection.disabled,'true');assert.equal(pendingSelection.selected,'false');assert.equal(pendingSelection.count,'3');
 await page.waitForFunction(()=>document.querySelector('[data-pick="4"]').getAttribute('aria-disabled')==='false');
 assert.equal(await page.evaluate(()=>fixtureControl.calls),1);
 assert.equal(await page.evaluate(()=>savedPick===document.querySelector('[data-pick="4"]') && neighbor===document.querySelector('[data-material-id="3"]')),true);
 assert.equal(await page.evaluate(()=>document.activeElement===savedPick),true);
 assert.equal(await page.locator('#basketCount').textContent(),'4');
 assert.match(await page.locator('#basketMeta').textContent(),/3 条待写脚本/);
 await page.locator('[data-pick="4"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-pick="4"]').getAttribute('aria-disabled')==='false');
 for(const mode of ['failIds','throwIds','emptyIds']){
  await page.evaluate(mode=>{window.fixtureControl={[mode]:[4]};},mode);
  await page.locator('[data-pick="4"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-pick="4"]').getAttribute('aria-disabled')==='false');
  assert.equal(await page.locator('[data-pick="4"]').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#basketCount').textContent(),'3');
 }
 await page.evaluate(()=>{window.fixtureControl={}});
 await page.locator('#selectedOnly').click();
 assert.equal(await page.locator('#materialGrid .card').count(),3);
 await page.locator('#accountFilter [data-acc="小红书官方号"]').click();
 assert.equal(await page.locator('#materialGrid .card').count(),1);
 assert.equal(await page.locator('#accountFilter [data-acc="小红书官方号"]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.acc),'小红书官方号');
 await page.locator('#materialSearch').fill('不存在的选题');
 assert.equal(await page.locator('#materialEmpty').isVisible(),true);
 await page.locator('#materialSearch').fill('');
 await page.locator('[data-pick="2"]').click();
 await page.waitForFunction(()=>!document.querySelector('[data-pick="2"]'));
 assert.equal(await page.evaluate(()=>document.activeElement.id),'selectedOnly');
 await page.locator('#selectedOnly').click();
 await page.locator('[data-pick="2"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-pick="2"]').getAttribute('aria-pressed')==='true');
 await page.locator('#accountFilter [data-acc="全部"]').click();
 await page.locator('#selectedOnly').click();
 await page.evaluate(()=>{
  window.fixtureControl={delay:180};
  document.querySelector('[data-pick="1"]').click();
  document.querySelector('[data-pick="3"]').focus();
 });
 await page.waitForFunction(()=>!document.querySelector('[data-pick="1"]'));
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.pick),'3');
 await page.locator('#selectedOnly').click();
 await page.evaluate(()=>{window.fixtureControl={}});
 await page.locator('[data-pick="1"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-pick="1"]').getAttribute('aria-disabled')==='false');
 await page.locator('#btnGoScripts').click();
 await page.waitForFunction(()=>document.activeElement?.dataset.pendingId==='2');
 await page.locator('.tab[data-view="materials"]').click();
 // Partial bulk failures must retain the failed selections and allow retry.
 await page.evaluate(()=>{window.fixtureControl={failIds:[2],throwIds:[3]}});
 await page.locator('#btnClearBasket').click();
 await page.waitForFunction(()=>document.getElementById('btnClearBasket').getAttribute('aria-disabled')==='false');
 assert.equal(await page.locator('#basketCount').textContent(),'2');
 assert.equal(await page.locator('[data-pick="1"]').getAttribute('aria-pressed'),'false');
 assert.equal(await page.locator('[data-pick="2"]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('[data-pick="3"]').getAttribute('aria-pressed'),'true');
 assert.match(await page.locator('#selectionStatus').textContent(),/2 条未保存/);
 await page.evaluate(()=>{window.fixtureControl={}});
 await page.locator('#btnClearBasket').click();
 await page.waitForFunction(()=>document.getElementById('basket').hidden);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'selectedOnly');
 for(const id of [1,2,3]){
  await page.locator('[data-pick="'+id+'"]').click();
  await page.waitForFunction(id=>document.querySelector('[data-pick="'+id+'"]').getAttribute('aria-disabled')==='false',id);
 }
 await page.locator('#materialGrid').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>!document.querySelector('#toastWrap .toast'));
 await page.screenshot({path:join(artifactDir,'selection.png'),animations:'disabled'});
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});
  await page.evaluate(()=>scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
  assert.ok(await page.locator('#basket').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight && el.getBoundingClientRect().top>=0));
  assert.ok(await page.evaluate(()=>document.querySelector('[data-pick="8"]').getBoundingClientRect().bottom<=document.getElementById('basket').getBoundingClientRect().top),'last selection button must remain reachable above the tray');
 }
 await page.locator('.library-toolbar').scrollIntoViewIfNeeded();
 await page.screenshot({path:join(artifactDir,'selection-mobile.png'),animations:'disabled'});
 await page.setViewportSize({width:1440,height:1000});
 // Workflow acceptance uses isolated records with explicit links and missing sources.
 await page.locator('.tab[data-view="home"]').click();
 await page.locator('#homeNext [data-focus-material="2"]').click();
 await page.waitForFunction(()=>document.activeElement?.dataset.pendingId==='2');
 assert.equal(await page.locator('#view-scripts').isVisible(),true);
 await page.locator('#pendingOnly').check();
 assert.equal(await page.locator('[data-pending-id="1"]').count(),0);
 await page.locator('#pendingOnly').uncheck();
 const dates=await page.evaluate(()=>{
  const today=StudioWorkflow.dayKey(), yesterday=StudioWorkflow.shiftDay(today,-1);
  fixture.scripts.push(
   {id:102,material_id:2,account:'小红书官方号',title:'法式拍摄清单',content:'这是最好的美甲',created_at:today},
   {id:103,material_id:3,account:'老板IP号',title:'店主日记',content:'聚光下的日常细节',created_at:today});
  fixture.materials[3].batch_id='old-batch';
  fixture.schedules.splice(0,fixture.schedules.length,
   {id:201,script_id:101,material_id:1,account:'抖音官方号',platform:'抖音',title:'已发布的琥珀作品',plan_batch:'p2',publish_at:yesterday+'T09:00:00+08:00'},
   {id:204,material_id:4,account:'店铺日常号',platform:'小红书',title:'收店后的灯光与作品细节',plan_batch:'p2',publish_at:yesterday+'T18:00:00+08:00'},
   {id:202,script_id:102,material_id:2,account:'小红书官方号',platform:'小红书',title:'今天的法式拍摄清单',plan_batch:'p2',publish_at:today+'T15:00:00+08:00'},
   {id:203,script_id:999,material_id:999,account:'抖音官方号',title:'已删除来源的排期',plan_batch:'p2',publish_at:today+'T17:00:00+08:00'},
   {id:205,account:'抖音官方号',title:'缺少日期的排期',plan_batch:'p2'});
  fixture.video_metrics.push({id:501,schedule_id:201,account:'抖音官方号',platform:'抖音',title:'已录入的琥珀作品',publish_date:yesterday,views:1200});
  return {today,yesterday};
 });
 await page.locator('.tab[data-view="admin"]').click();
 await page.locator('#btnReloadAll2').click();
 await page.locator('#syncState.is-ok').waitFor();
 await page.locator('.tab[data-view="scripts"]').click();
 assert.equal(await page.locator('[data-script-id]').count(),3);
 await page.locator('[data-script-status="scheduled"]').click();
 assert.equal(await page.locator('[data-script-id]').count(),2);
 await page.locator('[data-script-status="unplanned"]').click();
 assert.equal(await page.locator('[data-script-id="103"]').count(),1);
 await page.locator('[data-script-status="review"]').click();
 assert.equal(await page.locator('[data-script-id="102"]').count(),1);
 await page.locator('[data-script-status="all"]').click();
 await page.locator('#scriptSearch').fill('聚光');
 assert.equal(await page.locator('[data-script-id="103"]').count(),1);
 await page.locator('#scriptAccount').selectOption('小红书官方号');
 assert.equal(await page.locator('[data-script-id]').count(),0);
 await page.locator('#scriptSearch').fill('');
 assert.equal(await page.locator('[data-script-id="102"]').count(),1);
 await page.locator('#scriptAccount').selectOption('全部');
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 await page.screenshot({path:join(artifactDir,'scripts-workflow.png'),fullPage:true,animations:'disabled'});
 await page.locator('.tab[data-view="home"]').click();
 assert.equal(await page.locator('[data-calendar-day]').count(),7);
 assert.equal(await page.locator('#homeDayItems .calendar-item').count(),2);
 assert.match(await page.locator('#homeDayItems').textContent(),/原选题或脚本已不可用/);
 assert.doesNotMatch(await page.locator('#homeDayItems').textContent(),/缺少日期/);
 await page.locator('[data-open-script="102"]').click();
 assert.match(await page.locator('#modalBody').textContent(),/最好的美甲/);
 await page.locator('#modal button[data-close]').click();
 await page.locator('#homeNextWeek').click();
 assert.equal(await page.locator('#homeDayItems .calendar-item').count(),0);
 await page.locator('#homePrevWeek').click();
 assert.equal(await page.locator('#homeDayItems .calendar-item').count(),2);
 await page.locator('#homeToday').click();
 if(!await page.locator('[data-calendar-day="'+dates.yesterday+'"]').count()) await page.locator('#homePrevWeek').click();
 await page.locator('[data-calendar-day="'+dates.yesterday+'"]').click();
 assert.equal(await page.locator('#homeDayItems .calendar-item').count(),2);
 assert.match(await page.locator('#homeDayItems .calendar-item').first().textContent(),/已录入数据/);
 await page.locator('[data-open-metric="501"]').click();
 assert.equal(await page.locator('#mTitle').inputValue(),'已录入的琥珀作品');
 assert.match(await page.locator('#metricFormHint').textContent(),/编辑已有记录/);
 await page.locator('#btnCancelMetric').click();
 await page.locator('.tab[data-view="home"]').click();
 await page.locator('[data-record-schedule="204"]').click();
 assert.equal(await page.locator('#mSchedule').inputValue(),'204');
 assert.equal(await page.locator('#mTitle').inputValue(),'收店后的灯光与作品细节');
 assert.equal(await page.locator('#mAccount').inputValue(),'店铺日常号');
 assert.equal(await page.locator('#mPlatform').inputValue(),'小红书');
 assert.equal(await page.locator('#mDate').inputValue(),dates.yesterday);
 await page.locator('#btnCancelMetric').click();
 await page.locator('.tab[data-view="home"]').click();
 await page.locator('#homeDayItems [data-focus-material="4"]').click();
 await page.waitForFunction(()=>document.activeElement?.dataset.materialId==='4');
 assert.equal(await page.locator('#onlyLatest').isChecked(),false);
 assert.equal(await page.locator('[data-pick="4"]').getAttribute('aria-pressed'),'false');
 await page.locator('.tab[data-view="home"]').click();
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 await page.screenshot({path:join(artifactDir,'home-workflow.png'),fullPage:true,animations:'disabled'});
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:900});
  for(const view of ['home','scripts']){
   await page.locator('.tab[data-view="'+view+'"]').click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),view+' workflow overflow at '+width);
  }
 }
 assert.equal(await page.evaluate(()=>fixture.video_metrics.length),15,'Opening and canceling a form must not create records');
 // Local motion must always reveal the latest state, including during interruption.
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('.tab[data-view="home"]').click();
 await page.locator('#homeToday').click();
 const calendarMotion=await page.evaluate(()=>{
  document.getElementById('homeNextWeek').click();
  const items=document.getElementById('homeDayItems');
  const forward=items.getAnimations()[0]?.effect.getKeyframes()[0].transform;
  document.getElementById('homePrevWeek').click();
  const backward=items.getAnimations()[0]?.effect.getKeyframes()[0].transform;
  for(let i=0;i<5;i++){
   document.getElementById('homeNextWeek').click();
   document.getElementById('homePrevWeek').click();
  }
  return {forward,backward,running:items.getAnimations().length,selected:document.querySelector('.week-day.is-selected').dataset.calendarDay};
 });
 assert.equal(calendarMotion.forward,'translateX(14px)');
 assert.equal(calendarMotion.backward,'translateX(-14px)');
 assert.equal(calendarMotion.running,1);
 assert.equal(calendarMotion.selected,dates.today);
 await page.locator('.tab[data-view="scripts"]').click();
 assert.equal(await page.locator('#homeDayItems').evaluate(el=>el.getAnimations().length),0);
 const filteredMotion=await page.evaluate(()=>{
  const input=document.getElementById('scriptSearch');
  for(const value of ['聚光','','聚光']){input.value=value;input.dispatchEvent(new Event('input'));}
  const list=document.getElementById('scriptList');
  return {ids:[...list.children].map(el=>el.dataset.scriptId),animations:list.getAnimations({subtree:true}).length};
 });
 assert.deepEqual(filteredMotion.ids,['103']);
 assert.ok(filteredMotion.animations<=1);
 await page.locator('#scriptSearch').fill('');
 // Native modal semantics: background inert, initial reading focus and return focus.
 await page.locator('#scriptList [data-viewscript="101"]').click();
 assert.equal(await page.locator('#modal').evaluate(el=>el.matches(':modal')),true);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'modalTitle');
 assert.equal(await page.locator('#toastWrap').evaluate(el=>el.parentElement.id),'modal');
 await page.evaluate(()=>document.querySelector('.tab[data-view="home"]').focus());
 assert.equal(await page.evaluate(()=>document.activeElement.id),'modalTitle');
 await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'modalCopy');
 await page.keyboard.press('Shift+Tab');
 assert.equal(await page.evaluate(()=>document.getElementById('modal').contains(document.activeElement)),true);
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#modal').isVisible(),false);
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.viewscript),'101');
 assert.equal(await page.locator('#toastWrap').evaluate(el=>el.parentElement.tagName),'BODY');
 assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('script-dialog-open')),false);
 // Close during opening and reopen: no lingering dialog animation or stale focus.
 const reopen=await page.evaluate(()=>{
  const opener=document.querySelector('#scriptList [data-viewscript="101"]');
  opener.focus();opener.click();
  document.querySelector('#modal button[data-close]').click();
  const stopped=document.getElementById('modal').getAnimations({subtree:true}).length;
  opener.click();return {stopped,open:document.getElementById('modal').open};
 });
 assert.equal(reopen.stopped,0);assert.equal(reopen.open,true);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>document.getElementById('motionToggle').disabled);
 assert.equal(await page.locator('#modal').evaluate(el=>el.getAnimations({subtree:true}).length),0);
 await page.keyboard.press('Escape');
 await page.locator('.tab[data-view="home"]').click();
 await page.locator('#homeNextWeek').click();
 assert.equal(await page.locator('#homeDayItems').evaluate(el=>el.getAnimations().length),0);
 await page.locator('#homeToday').click();
 await page.emulateMedia({reducedMotion:'no-preference'});
 // Inline confirmations stay interactive in the modal; Escape cancels just the confirmation.
 await page.locator('.tab[data-view="scripts"]').click();
 await page.locator('#scriptList [data-viewscript="102"]').click();
 await page.locator('#modalFix').click();
 assert.equal(await page.locator('#modal .confirm-bar').isVisible(),true);
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#modal').isVisible(),true);
 assert.equal(await page.locator('#modal .confirm-bar').count(),0);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'modalFix');
 await page.locator('#modalFix').click();
 await page.locator('#modal .confirm-bar [data-yes]').click();
 await page.waitForFunction(()=>document.getElementById('modalFix').hidden);
 assert.doesNotMatch(await page.locator('#modalBody').textContent(),/这是最好的美甲/);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'modalTitle');
 assert.equal(await page.locator('#modal #toastWrap .toast').count()>0,true);
 await page.keyboard.press('Escape');
 // Long scripts remain readable with controls reachable on small screens.
 await page.evaluate(()=>{fixture.scripts[0].content=('## 拍摄镜头与口播\n\n展示指尖的光泽、甲型与细节，记录真实的上手效果。\n\n').repeat(50)});
 await page.locator('.tab[data-view="scripts"]').click();
 await page.locator('#scriptList [data-viewscript="101"]').click();
 await page.waitForFunction(()=>!document.querySelector('#toastWrap .toast'));
 await page.screenshot({path:join(artifactDir,'script-dialog.png'),animations:'disabled'});
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  assert.ok(await page.locator('#modal').evaluate(el=>el.scrollWidth<=innerWidth),'dialog overflow at '+width);
  assert.ok(await page.locator('#modalBody').evaluate(el=>el.scrollHeight>el.clientHeight));
  await page.locator('#modalBody').evaluate(el=>{el.scrollTop=el.scrollHeight});
  assert.ok(await page.locator('#modal button[data-close]').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight));
 }
 await page.screenshot({path:join(artifactDir,'script-dialog-mobile.png'),animations:'disabled'});
 await page.keyboard.press('Escape');
 // A refreshed list replaces the original opener; focus returns to its replacement.
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('#scriptList [data-viewscript="101"]').click();
 await page.evaluate(()=>document.getElementById('scriptSearch').dispatchEvent(new Event('input')));
 await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.viewscript),'101');
 assert.equal(await page.evaluate(()=>document.activeElement.closest('#scriptList')?.id),'scriptList');
 if(process.env.STUDIO_RECORD_DEMO==='1'){
  const demo=await browser.newPage({viewport:{width:1440,height:1000},recordVideo:{dir:artifactDir,size:{width:1440,height:1000}}});
  const selectionDemo=process.env.STUDIO_DEMO_KIND==='selection';
  const demoRecords=selectionDemo ? structuredClone(fixture) : await page.evaluate(()=>fixture);
  demoRecords.scripts[0].content='## 秋日指尖，留一点温柔的琥珀色\n\n用真实上手效果，记录一束光里的秋天。\n\n### 00–03 秒 · 光落在指尖\n\n近景拍摄琥珀猫眼，手指轻轻转动，让光带自然移动。\n\n### 03–12 秒 · 看见细节\n\n切换侧面和俯拍角度，展示短甲的弧度与颜色层次。\n\n### 12–20 秒 · 回到日常\n\n手拿咖啡杯或翻动书页，让款式进入真实生活。\n\n### 发布文案\n\n换季想留一点温暖，从指尖开始。你喜欢偏透的琥珀色，还是更浓一点的焦糖色？';
  await prepare(demo,demoRecords);
  await demo.evaluate(()=>{document.querySelector('.studio-page-heading .eyebrow').textContent='交互演示 · 隔离示例数据'});
  if(selectionDemo){
   await demo.locator('.tab[data-view="materials"]').click();
   await demo.locator('#materialGrid').scrollIntoViewIfNeeded();
   await demo.evaluate(()=>{window.fixtureControl={delay:400}});
   await demo.waitForTimeout(900);
   await demo.locator('[data-pick="4"]').click();await demo.waitForTimeout(900);
   await demo.locator('#accountFilter [data-acc="小红书官方号"]').click();await demo.waitForTimeout(900);
   await demo.locator('#accountFilter [data-acc="全部"]').click();await demo.waitForTimeout(700);
   await demo.locator('#selectedOnly').click();await demo.waitForTimeout(900);
   await demo.locator('[data-pick="4"]').click();await demo.waitForTimeout(1000);
   await demo.locator('#btnGoScripts').click();await demo.waitForTimeout(1100);
  }else{
  await demo.locator('.home-calendar').scrollIntoViewIfNeeded();
  await demo.waitForTimeout(900);
  await demo.locator('#homeNextWeek').click();await demo.waitForTimeout(750);
  await demo.locator('#homePrevWeek').click();await demo.waitForTimeout(750);
  await demo.locator('[data-calendar-day="'+dates.today+'"]').click();await demo.waitForTimeout(750);
  await demo.locator('.tab[data-view="scripts"]').click();await demo.waitForTimeout(900);
  await demo.locator('[data-script-status="unplanned"]').click();await demo.waitForTimeout(900);
  await demo.locator('[data-script-status="all"]').click();await demo.waitForTimeout(900);
  await demo.locator('#scriptList [data-viewscript="101"]').click();await demo.waitForTimeout(1100);
  await demo.locator('#modalBody').evaluate(el=>el.scrollTo({top:320,behavior:'smooth'}));await demo.waitForTimeout(900);
  await demo.keyboard.press('Escape');await demo.waitForTimeout(900);
  }
  const video=demo.video();await demo.close();
  await video.saveAs(join(artifactDir,'interactions.webm'));await video.delete();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: overview counts, search, selection, script handoff, video modes, filtered charts/ranking, empty states, 9 views × 5 widths, motion preference persistence, keyboard links, animation cancellation, rapid navigation, reduced motion; exact topic navigation, composed script filters, calendar navigation and linked forms, missing sources, directional calendar motion, interrupted filters, saved selection feedback, rejected writes and partial bulk retry, composed selection filters, stable pick focus, native modal focus/inert background, immediate close/reopen, reduced dialog motion and long mobile scripts; no uncaught errors.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
