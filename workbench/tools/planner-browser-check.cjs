// Read-only acceptance of the planning workspace with isolated cloud fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const {fixture,prepare}=require('./studio-fixture.cjs');
const origin=process.env.STUDIO_URL||'http://127.0.0.1:4318';
const dir=process.env.STUDIO_ARTIFACT_DIR||'/private/tmp/tfs-planner';
mkdirSync(dir,{recursive:true});
const records=structuredClone(fixture);
records.scripts.push({id:102,material_id:2,account:'小红书官方号',title:'光线里的法式松弛感',content:'## 拍摄脚本\n\n0–3秒：展示上手效果。\n3–12秒：近拍光泽与指尖细节。'});
records.schedules=[
 {id:'a',title:'秋日指尖，留一点温柔的琥珀色',account:'抖音官方号',script_id:101,material_id:1,publish_at:'2026-10-13T16:30:00Z',shoot_date:'2026-10-13'},
 {id:'b',title:'光线里的法式松弛感',account:'小红书官方号',script_id:102,material_id:2,publish_at:'2026-10-15T19:30:00+08:00',shoot_date:'2026-10-13'},
 {id:'c',title:'开店十二年，我坚持的小事',account:'老板IP号',material_id:3,publish_at:'2026-10-16T18:00:00+08:00',shoot_date:'2026-10-16'},
 {id:'d',title:'收店前的十分钟',account:'店铺日常号',material_id:4,publish_at:'2026-10-18T20:00:00+08:00',shoot_date:'2026-10-16'},
 {id:'e',title:'一周的指尖作品合集',account:'小红书官方号',script_id:102,publish_at:'2026-10-17T12:00:00+08:00',shoot_date:'2026-10-16'},
 {id:'f',title:'来源已删除的历史内容',account:'抖音官方号',script_id:999,publish_at:'2026-10-12T10:00:00+08:00',shoot_date:'2026-10-13'},
 {id:'g',title:'缺少发布日期的内容',account:'店铺日常号',material_id:4,publish_at:'bad',shoot_date:'2026-10-16'},
 {id:'h',title:'下一周的暖棕灵感',account:'小红书官方号',script_id:102,publish_at:'2026-10-21T12:00:00+08:00',shoot_date:null},
 {id:'i',title:'周三午后的光泽记录',account:'抖音官方号',script_id:101,publish_at:'2026-10-14T14:00:00+08:00',shoot_date:'2026-10-13'},
].map(row=>({...row,plan_batch:'planner-demo',platform:row.account==='抖音官方号'?'抖音':'小红书',shoot_slot:'上午 10:00–12:00',status:'planned'}));
records.schedules.push({id:'old',plan_batch:'old-batch',title:'旧批次不可见',publish_at:'2026-10-14T10:00:00+08:00'});
records.video_metrics.push({id:'metric-a',schedule_id:'a',title:'琥珀色表现',account:'抖音官方号',platform:'抖音',publish_date:'2026-10-14',views:1200});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const errors=[];
 const page=await browser.newPage({viewport:{width:1600,height:1050},timezoneId:'America/Los_Angeles',recordVideo:process.env.STUDIO_RECORD_DEMO==='1'?{dir,size:{width:1600,height:1050}}:undefined});
 await page.clock.setFixedTime(new Date('2026-10-14T07:00:00Z'));
 await prepare(page,{origin,records,errors});
 await page.locator('.tab[data-view="schedule"]').click();
 assert.match(await page.locator('#scheduleWeekLabel').textContent(),/2026年 10月12日 — 10月18日/);
 assert.equal(await page.locator('#scheduleBoard .schedule-task').count(),7);
 assert.equal(await page.locator('#scheduleUndated .schedule-task').count(),1);
 assert.equal(await page.locator('[data-plan-id="old"]').count(),0);
 assert.match(await page.locator('[data-plan-id="a"] .schedule-task-time').textContent(),/00:30/);
 assert.match(await page.locator('[data-plan-id="a"]').textContent(),/已录入数据/);
 assert.match(await page.locator('[data-plan-id="i"]').textContent(),/计划时间已到/);
 assert.doesNotMatch(await page.locator('[data-plan-id="i"]').textContent(),/已发布/);
 assert.match(await page.locator('[data-plan-id="f"]').textContent(),/原选题或脚本已不可用/);
 await page.screenshot({path:join(dir,'publish.png'),fullPage:true,animations:'disabled'});
 await page.locator('#scheduleAccount').selectOption('小红书官方号');
 assert.equal(await page.locator('#scheduleBoard .schedule-task').count(),2);
 await page.locator('[data-schedule-mode="shoot"]').click();
 assert.equal(await page.locator('#scheduleBoard .schedule-task').count(),2);
 assert.equal(await page.locator('#scheduleUndated .schedule-task').count(),1);
 await page.locator('#scheduleAccount').selectOption('全部');
 assert.equal(await page.locator('#scheduleBoard .schedule-task').count(),8);
 await page.screenshot({path:join(dir,'shoot.png'),fullPage:true,animations:'disabled'});
 await page.locator('[data-plan-id="b"] [data-open-script]').click();
 assert.equal(await page.locator('#modal').isVisible(),true);
 await page.locator('#modal button[data-close]').click();
 assert.equal(await page.locator('[data-plan-id="b"] [data-open-script]').evaluate(el=>el===document.activeElement),true);
 await page.locator('[data-plan-id="b"] [data-shoot-script]').click();
 assert.equal(await page.locator('dialog.shooting-dialog').isVisible(),true);
 await page.keyboard.press('Escape');
 await page.locator('[data-schedule-mode="publish"]').click();
 await page.locator('#scheduleNext').click();
 assert.equal(await page.locator('#scheduleBoard .schedule-task').count(),1);
 await page.locator('#scheduleNext').click();
 assert.equal(await page.locator('#scheduleNoWeek').isVisible(),true);
 await page.locator('#scheduleNearest').click();
 assert.equal(await page.locator('#scheduleBoard .schedule-task').count(),7);
 await page.locator('#scheduleAccount').selectOption('店铺日常号');
 await page.locator('#scheduleNext').click();
 assert.equal(await page.locator('#scheduleNoWeek').isVisible(),true);
 await page.locator('#scheduleClear').click();
 assert.equal(await page.locator('#scheduleBoard .schedule-task').count(),1);
 await page.locator('#scheduleToday').click();
 await page.locator('[data-plan-id="a"] [data-open-metric]').click();
 assert.equal(await page.locator('#mTitle').inputValue(),'琥珀色表现');
 await page.locator('#btnCancelMetric').click();
 await page.locator('.tab[data-view="schedule"]').click();
 await page.locator('[data-plan-id="i"] [data-record-schedule]').click();
 assert.equal(await page.locator('#mSchedule').inputValue(),'i');
 assert.equal(await page.locator('#mTitle').inputValue(),'周三午后的光泽记录');
 await page.locator('#btnCancelMetric').click();
 await page.locator('.tab[data-view="schedule"]').click();
 await page.locator('#scheduleGenerator summary').click();
 assert.equal(await page.locator('#btnAutoSchedule').isVisible(),true);
 await page.locator('#scheduleGenerator summary').click();
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('#scheduleNext').click();await page.locator('#schedulePrev').click();
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
 assert.equal(await page.evaluate(()=>window.fixtureWrites||0),0);
 assert.deepEqual(errors,[]);
 const video=page.video();await page.close();if(video){await video.saveAs(join(dir,'planner.webm'));await video.delete();}
 const mobile=await browser.newPage();
 await mobile.clock.setFixedTime(new Date('2026-10-14T07:00:00Z'));await prepare(mobile,{origin,records,errors});
 await mobile.locator('.tab[data-view="schedule"]').click();
 for(const width of [1440,1280,1024,768,390,320]){
  await mobile.setViewportSize({width,height:950});
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow at '+width);
  if(width===390){
   await mobile.locator('.schedule-planner').scrollIntoViewIfNeeded();
   await mobile.screenshot({path:join(dir,'mobile.png'),animations:'disabled'});
  }
  await mobile.locator('[data-schedule-mode="shoot"]').click();
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'shooting overflow at '+width);
  await mobile.locator('[data-schedule-mode="publish"]').click();
 }
 await mobile.locator('#scheduleGenerator summary').click();
 assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'expanded generator at 320px');
 assert.deepEqual(errors,[]);await mobile.close();
 const empty=await browser.newPage();
 await prepare(empty,{origin,records:{...records,schedules:[]},errors});
 await empty.locator('.tab[data-view="schedule"]').click();
 assert.equal(await empty.locator('#scheduleEmpty').isVisible(),true);
 assert.equal(await empty.locator('#scheduleBoard .schedule-task').count(),0);
 assert.equal(await empty.locator('#scheduleUndated').isVisible(),false);
 await empty.locator('[data-schedule-mode="shoot"]').click();
 assert.equal(await empty.locator('#scheduleEmpty').isVisible(),true);
 assert.equal(await empty.evaluate(()=>window.fixtureWrites||0),0);
 await empty.close();assert.deepEqual(errors,[]);
 console.log('PASS: publish/shoot weeks, Shanghai dates on US timezone, account filters, nearest week, missing dates and sources, current batch only, real record status, script/shooting actions, focus return, metric prefill without writes, generator access, 6 widths and reduced motion.');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
