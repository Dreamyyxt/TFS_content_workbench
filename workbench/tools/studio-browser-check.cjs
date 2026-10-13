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
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*', async route=>{
  const url=route.request().url();
  if(url.includes('cdn.jsdelivr.net')) return route.fulfill({contentType:'application/javascript',body:`window.WorkBuddyCloud={createWorkBuddyCloud:()=>({database:{from:table=>{let rows=window.fixture[table]||[];let patch=null;const q={select(){return q},order(){return q},limit(){return q},eq(key,value){rows=rows.filter(r=>r[key]===value);return q},update(p){patch=p;return q},then(resolve){if(patch)rows.forEach(r=>Object.assign(r,patch));return Promise.resolve({data:rows,error:null}).then(resolve)}};return q}},llm:{models:{list:async()=>[{id:'test-model',name:'测试模型',maxInputTokens:1000,maxOutputTokens:1000}]}}})};`});
  if(url.startsWith(origin+'/'))return route.continue();
  return route.abort();
 });
 await page.addInitScript(f=>{window.fixture=f},fixture);
 await page.goto(origin);
 await page.locator('#syncState.is-ok').waitFor({timeout:10000});
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
 assert.deepEqual(errors,[]);
 console.log('PASS: overview counts, search, selection, script handoff, video modes, filtered charts/ranking, empty states, 9 views × 5 widths, motion preference persistence, keyboard links, animation cancellation, rapid navigation, reduced motion; no uncaught errors.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
