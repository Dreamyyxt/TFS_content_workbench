// Mock both cloud and local production APIs: no uploads, generations, retries or exports are executed.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {mkdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {join}=require('node:path');
const {prepare}=require('./studio-fixture.cjs');
const origin=process.env.STUDIO_URL||'http://127.0.0.1:4318';
const dir=process.env.STUDIO_ARTIFACT_DIR||'/private/tmp/tfs-production';
const baseline=process.env.STUDIO_BASELINE||'8b98a75';mkdirSync(dir,{recursive:true});
const jobs=[
 {id:'draft',mode:'edit',status:'draft_ready',title:'秋日琥珀 · 剪映草稿',draft_path:'/example/draft',edit_plan:{shots:[]}},
 {id:'finished',mode:'generate',status:'finished',title:'微光猫眼 · 成片',finished_at:'2026-10-15T08:05:00Z'},
 {id:'active',mode:'generate',status:'generating',title:'柔和光线 · 生成中',remote_id:'cgt-active',remote_status:'running'},
 {id:'failed',mode:'edit',status:'failed',title:'法式细节 · 待检查',error:'示例：镜头长度需要调整'},
 {id:'unknown',mode:'generate',status:'submission_unknown',title:'秋日门店 · 待核对',error:'示例：请核对远端任务 ID'}
].map(job=>({assets:[],reference_videos:[],duration:5,created_at:new Date(Date.now()-180000).toISOString(),account:'抖音官方号',...job}));
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const errors=[],writes=[];let fail=false,currentJobs=structuredClone(jobs);
 async function mock(page){await page.route('http://127.0.0.1:4191/api/jianying/**',route=>{
  const path=new URL(route.request().url()).pathname.split('/api/jianying/')[1];
  if(route.request().method()!=='GET'){writes.push(path);return route.abort();}
  if(fail&&path==='status')return route.fulfill({status:503,contentType:'application/json',body:'{"error":"offline"}'});
  const data=path==='session'?{token:'isolated-test'}:path==='status'?{online:true,device:{ready:true,skill_version:'fixture'}}:path==='generation/status'?{ready:true}:path==='jobs'?currentJobs:{};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });}
 if(process.env.STUDIO_CAPTURE_BEFORE==='1'){
  const before=await browser.newPage({viewport:{width:1600,height:1100}});await prepare(before,{origin,errors});await mock(before);
  for(const name of ['jianying-studio.js','studio.css'])await before.route('**/'+name,route=>route.fulfill({contentType:name.endsWith('.css')?'text/css':'application/javascript',body:execFileSync('git',['show',baseline+':workbench/'+name],{encoding:'utf8'})}));
  await before.route(origin+'/',route=>route.fulfill({contentType:'text/html',body:execFileSync('git',['show',baseline+':workbench/index.html'],{encoding:'utf8'})}));
  await before.reload();await before.locator('#syncState.is-ok').waitFor();await before.locator('.tab[data-view="video"]').click();await before.locator('#jyJobs .jy-job').first().waitFor();
  await before.locator('.video-tasks').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await before.screenshot({path:join(dir,'before.png'),animations:'disabled'});await before.close();
 }
 const page=await browser.newPage({viewport:{width:1600,height:1100}});await prepare(page,{origin,errors});await mock(page);await page.locator('.tab[data-view="video"]').click();await page.locator('#jyConnect').click();await page.locator('#jyJobs .jy-job').first().waitFor();
 assert.equal(await page.locator('#jyPreparation li').count(),3);assert.match(await page.locator('#jyPreparation').textContent(),/至少添加/);
 await page.locator('#jyModeGenerate').click();await page.locator('#jyScript').fill('阳光下的琥珀猫眼');
 await page.waitForFunction(()=>document.querySelectorAll('#jyPreparation .is-ready').length===3);
 await page.locator('#jyTitle').fill('');assert.equal(await page.locator('#jyPreparation .is-ready').count(),2);await page.locator('#jyTitle').fill('秋日作品');
 await page.locator('.production-preparation').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:join(dir,'preparation.png'),animations:'disabled'});
 const visible=()=>page.locator('#jyJobs .jy-job:visible');assert.equal(await visible().count(),5);
 await page.locator('.video-tasks').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:join(dir,'tasks.png'),animations:'disabled'});
 await page.locator('[data-job-filter="draft"]').click();assert.equal(await visible().count(),1);assert.match(await visible().textContent(),/剪映中检查/);assert.equal(await visible().getByRole('button',{name:'预览视频'}).count(),0);
 await page.locator('#jyJobSearch').fill('不存在');assert.equal(await visible().count(),0);assert.equal(await page.locator('#jyJobsEmpty').isVisible(),true);
 await page.locator('#jyJobClear').click();assert.equal(await visible().count(),5);assert.equal(await page.locator('#jyJobSearch').evaluate(el=>el===document.activeElement),true);
 await page.locator('[data-job-filter="finished"]').click();assert.equal(await visible().getByRole('button',{name:'预览视频'}).count(),1);
 await page.locator('[data-job-filter="attention"]').click();assert.equal(await visible().count(),2);
 const reconcile=page.locator('[data-job-id="unknown"] .video-reconcile input');await reconcile.fill('cgt-user-typing');await reconcile.focus();
 // Force a real card update while a user is entering a remote ID.
 currentJobs.find(job=>job.id==='unknown').error='示例：状态更新，仍需核对';await page.evaluate(()=>window.JianyingStudio.reconnect());
 await page.waitForFunction(()=>document.querySelector('[data-job-id="unknown"] .video-job-error').textContent.includes('状态更新'));
 assert.equal(await reconcile.inputValue(),'cgt-user-typing');assert.equal(await reconcile.evaluate(el=>el===document.activeElement),true);
 await page.locator('[data-job-filter="active"]').click();await page.locator('[data-job-id="active"] details').evaluate(el=>el.open=true);
 const activeFilter=page.locator('[data-job-filter="active"]');await activeFilter.focus();currentJobs.find(job=>job.id==='active').last_checked_at=new Date().toISOString();await page.evaluate(()=>window.JianyingStudio.reconnect());
 await page.waitForFunction(()=>document.querySelector('[data-job-id="active"] .video-progress-detail').textContent.includes('最近查询'));
 assert.equal(await activeFilter.evaluate(el=>el===document.activeElement),true);assert.equal(await page.locator('[data-job-id="active"] details').getAttribute('open'),'');
 await page.locator('[data-job-id="active"] summary').focus();const activeJob=currentJobs.find(job=>job.id==='active');activeJob.status='finished';activeJob.finished_at=new Date().toISOString();await page.evaluate(()=>window.JianyingStudio.reconnect());
 await page.waitForFunction(()=>document.querySelector('#jyJobsEmpty').hidden===false);assert.equal(await activeFilter.evaluate(el=>el===document.activeElement),true);
 activeJob.status='generating';delete activeJob.finished_at;await page.evaluate(()=>window.JianyingStudio.reconnect());await page.locator('[data-job-id="active"]').waitFor();
 fail=true;await page.locator('#jyRefresh').click();await page.waitForFunction(()=>document.querySelector('#jyPreparation').textContent.includes('连接本机制作服务'));
 assert.equal(await visible().count(),1);fail=false;await page.locator('#jyConnect').click();await page.locator('#jyJobClear').click();
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.getElementById('motionToggle').disabled);
 for(const width of [1440,1200,1024,768,600,390,320]){
  await page.setViewportSize({width,height:950});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow at '+width);
  if(width===390){await page.locator('.video-tasks').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:join(dir,'mobile.png'),animations:'disabled'});}
 }
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
 currentJobs=[];await page.locator('#jyRefresh').click();await page.waitForFunction(()=>document.querySelector('#jyJobs .empty'));
 assert.equal(await page.locator('#jyJobsEmpty').isVisible(),false);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);await page.close();
 console.log('PASS: preparation, task status/search/reset, drafts versus finished media, reconcile typing and focus during refresh, preserved details/filter focus, connection failure, empty states, 7 widths, reduced motion and zero production writes.');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
