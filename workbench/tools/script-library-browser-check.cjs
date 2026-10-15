const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {mkdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {join}=require('node:path');
const {fixture,prepare}=require('./studio-fixture.cjs');
const origin=process.env.STUDIO_URL||'http://127.0.0.1:4318';
const baseline=process.env.STUDIO_BASELINE||'612a9dd';
const dir=process.env.STUDIO_ARTIFACT_DIR||'/private/tmp/tfs-script-library';
mkdirSync(dir,{recursive:true});
const records=structuredClone(fixture);
records.scripts=[{id:101,material_id:1,account:'抖音官方号',title:'把秋天的琥珀光，留在指尖',duration:'20 秒',created_at:'2026-10-14T16:30:00Z',content:`## 分镜表
| 时间 | 画面 / 运镜 | 口播 | 字幕 |
| --- | --- | --- | --- |
| 0–3秒 | 靠近窗边，特写琥珀猫眼，让指尖缓缓转动。 | 阳光落在指尖，颜色也有了温度。 | 秋日琥珀 |
| 3–12秒 | 切换侧面和俯拍角度，展示短甲弧度与光泽层次。 | 短甲也可以有这样轻盈的光泽。 | 看见细节 |
| 12–20秒 | 手拿咖啡杯，翻动书页，让款式回到日常生活。 | 留一点温暖，给忙碌的日常。 | 你的秋日配色 |`},
{id:102,material_id:2,account:'小红书官方号',title:'收店前，记录一份法式松弛感',created_at:'2026-10-13T02:00:00Z',content:'## 拍摄思路\n\n这是最好的美甲。傍晚的光线落在作品上，先拍一张上手全景，再靠近记录细节。\n\n## 口播\n忙碌一天，留一刻安静给自己。'},
{id:103,material_id:3,account:'老板IP号',title:'开店十二年，我坚持的小事',content:''},
{id:104,account:'抖音官方号',title:'待整理的旧格式脚本',created_at:'invalid',content:'| 时间 | 画面 |\n| --- | --- |\n| 0–3秒 | 指尖 | 多了一列 |\n\n原文备注保留。'}];
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const errors=[];
 if(process.env.STUDIO_CAPTURE_BEFORE==='1'){
  const before=await browser.newPage({viewport:{width:1600,height:1050}});
  await prepare(before,{origin,records,errors});
  for(const name of ['app.js','studio.css','studio-workflow.js']){
   const source=execFileSync('git',['show',baseline+':workbench/'+name],{encoding:'utf8'});
   await before.route('**/'+name,route=>route.fulfill({contentType:name.endsWith('.css')?'text/css':'application/javascript',body:source}));
  }
  const html=execFileSync('git',['show',baseline+':workbench/index.html'],{encoding:'utf8'});
  await before.route(origin+'/',route=>route.fulfill({contentType:'text/html',body:html}));
  await before.reload();await before.locator('#syncState.is-ok').waitFor();
  await before.locator('.tab[data-view="scripts"]').click();
  await before.screenshot({path:join(dir,'before.png'),animations:'disabled'});await before.close();
 }
 const page=await browser.newPage({viewport:{width:1600,height:1050},timezoneId:'America/Los_Angeles'});
 await prepare(page,{origin,records,errors});await page.locator('.tab[data-view="scripts"]').click();
 const card=id=>page.locator('#scriptList [data-script-id="'+id+'"]');
 const ids=()=>page.locator('#scriptList [data-script-id]').evaluateAll(nodes=>nodes.map(el=>Number(el.dataset.scriptId)));
 assert.deepEqual(await ids(),[101,102,103,104]);
 assert.equal(await card(101).locator('.script-shot').count(),2);
 assert.match(await card(101).textContent(),/共 3 镜/);
 assert.match(await card(101).textContent(),/阳光落在指尖/);
 assert.match(await card(101).locator('time').textContent(),/10月15日/);
 assert.match(await card(102).locator('.script-source-excerpt').textContent(),/傍晚的光线/);
 assert.match(await card(104).textContent(),/原文预览/);
 assert.equal(await card(104).locator('.script-shot').count(),0);
 assert.equal(await card(103).locator('[data-shoot-script]').isDisabled(),true);
 assert.equal(await card(103).locator('.risk').textContent(),'暂无正文');
 await page.screenshot({path:join(dir,'library.png'),animations:'disabled'});
 await page.locator('#scriptSort').selectOption('oldest');assert.deepEqual(await ids(),[102,101,103,104]);
 await page.locator('#scriptSort').selectOption('newest');
 await page.locator('#scriptAccount').selectOption('小红书官方号');
 await page.locator('#scriptSearch').fill('傍晚');
 await page.locator('[data-script-status="review"]').click();assert.deepEqual(await ids(),[102]);
 await page.locator('#scriptSearch').fill('不存在的内容');
 assert.equal(await page.locator('#scriptEmpty').isVisible(),true);
 await page.locator('#scriptEmpty [data-clear-script-filters]').click();
 assert.deepEqual(await ids(),[101,102,103,104]);assert.equal(await page.locator('#scriptSearch').inputValue(),'');
 assert.equal(await page.locator('#scriptAccount').inputValue(),'全部');
 assert.equal(await page.locator('#scriptSearch').evaluate(el=>el===document.activeElement),true);
 await card(101).locator('[data-viewscript]').click();assert.equal(await page.locator('#modal').isVisible(),true);
 await page.keyboard.press('Escape');assert.equal(await card(101).locator('[data-viewscript]').evaluate(el=>el===document.activeElement),true);
 await card(101).locator('[data-shoot-script]').click();assert.equal(await page.locator('#shootDialog').isVisible(),true);await page.keyboard.press('Escape');
 await card(102).locator('.script-review summary').click();
 assert.match(await card(102).locator('.script-review-body').textContent(),/最好/);
 await card(102).locator('[data-fixscript]').click();await page.locator('.confirm-bar [data-no]').click();
 assert.equal(await page.evaluate(()=>window.fixtureWrites||0),0);
 await card(102).locator('[data-delscript]').click();await page.locator('.confirm-bar [data-no]').click();
 assert.equal(await page.locator('#scriptList .script-card').count(),4);
 await card(101).locator('[data-makevideo]').click();assert.equal(await page.locator('#view-video').isVisible(),true);
 await page.locator('.tab[data-view="scripts"]').click();
 await page.evaluate(()=>{fixture.scripts[0].content=fixture.scripts[0].content.replace('靠近窗边','<img src=x onerror="window.unsafePreview=true">');});
 await page.locator('#scriptSearch').fill('');await page.locator('#scriptSort').selectOption('oldest');
 assert.equal(await card(101).locator('.script-shot img').count(),0);
 assert.match(await card(101).locator('.script-shot').first().textContent(),/<img/);
 assert.equal(await page.evaluate(()=>!!window.unsafePreview),false);
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.getElementById('motionToggle').disabled);await page.locator('#scriptSort').selectOption('newest');
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
 assert.equal(await page.evaluate(()=>window.fixtureWrites||0),0);await page.close();
 const mobile=await browser.newPage();await prepare(mobile,{origin,records,errors});await mobile.locator('.tab[data-view="scripts"]').click();
 for(const width of [1440,1200,1024,768,390,320]){
  await mobile.setViewportSize({width,height:950});assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow at '+width);
  if(width===390){await mobile.locator('#scriptList .script-card').first().evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));await mobile.screenshot({path:join(dir,'mobile.png'),animations:'disabled'});}
 }
 await mobile.close();assert.deepEqual(errors,[]);
 console.log('PASS: real shot previews and text fallback, empty content, Shanghai dates, stable sorting, combined filters and reset, original read/shoot/video actions, review/delete cancellation, escaped content, reduced motion, 6 widths and zero cloud writes.');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
