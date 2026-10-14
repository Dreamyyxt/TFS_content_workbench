const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const {fixture,prepare}=require('./studio-fixture.cjs');
const origin=process.env.STUDIO_URL || 'http://127.0.0.1:4318';
const artifactDir=process.env.STUDIO_ARTIFACT_DIR || '/private/tmp/tfs-shooting-check';
mkdirSync(artifactDir,{recursive:true});
const source=`## 一句话脚本定位
用真实上手效果记录秋天。

## 分镜表
| 时间 | 画面 / 运镜 | 口播 | 字幕 / 贴纸 |
| --- | --- | --- | --- |
| 0–3秒 | 靠近窗边，特写拍摄琥珀猫眼，让指尖缓慢转动。 | 阳光落在指尖，颜色也有了温度。 | 秋日琥珀 |
| 3–12秒 | 切换侧面和俯拍角度，展示短甲弧度与颜色层次。 | 短甲也可以有这样轻盈的光泽。 | 看见细节 |
| 12–20秒 | 手拿咖啡杯，自然翻动书页，让款式回到真实生活。 | 留一点温暖，给忙碌的日常。 | 你的秋日配色 |

## 发布配置
- 发布标题：把秋天留在指尖
- 标签：美甲作品

## 合规提示
使用真实作品，不编造效果。`;
const records=structuredClone(fixture);
records.scripts[0].content=source;
records.scripts.push({id:102,material_id:2,account:'小红书官方号',title:'旧格式脚本',content:'0–3秒：展示指尖\n3–12秒：转动手腕\n\n拍摄时注意自然光。'},{id:103,material_id:3,account:'老板IP号',title:'空脚本',content:''});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const errors=[];
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await prepare(page,{origin,records,errors});
 await page.locator('.tab[data-view="scripts"]').click();
 assert.equal(await page.locator('[data-shoot-script="103"]').isDisabled(),true);
 await page.locator('[data-shoot-script="101"]').click();
 assert.equal(await page.locator('#shootDialog').evaluate(el=>el.matches(':modal')),true);
 assert.equal(await page.locator('#shootSteps button').count(),3);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'shootTitle');
 assert.match(await page.locator('#shootFields').textContent(),/靠近窗边/);
 assert.doesNotMatch(await page.locator('#shootFields').textContent(),/发布标题/);
 assert.equal(await page.locator('#shootPrev').isDisabled(),true);
 await page.evaluate(()=>document.querySelector('.tab[data-view="home"]').focus());
 assert.equal(await page.evaluate(()=>document.activeElement.id),'shootTitle');
 await page.keyboard.press('Shift+Tab');
 assert.equal(await page.evaluate(()=>document.getElementById('shootDialog').contains(document.activeElement)),true);
 await page.locator('#shootMark').click();
 assert.equal(await page.locator('#shootCount').textContent(),'已拍 1 / 3');
 assert.equal(await page.locator('#shootPosition').textContent(),'01 / 03');
 await page.locator('#shootNext').click();
 assert.equal(await page.locator('#shootCount').textContent(),'已拍 1 / 3');
 assert.equal(await page.locator('#shootPosition').textContent(),'02 / 03');
 await page.locator('[data-shoot-size="extra"]').click();
 await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.shootScript),'101');
 assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('shooting-open')),false);
 await page.reload();await page.locator('#syncState.is-ok').waitFor();
 await page.locator('.tab[data-view="scripts"]').click();
 await page.locator('[data-shoot-script="101"]').click();
 assert.equal(await page.locator('#shootPosition').textContent(),'02 / 03');
 assert.equal(await page.locator('#shootCount').textContent(),'已拍 1 / 3');
 assert.equal(await page.locator('#shootBody').getAttribute('data-size'),'extra');
 await page.locator('[data-shot-index="0"]').click();
 assert.equal(await page.locator('#shootMark').getAttribute('aria-pressed'),'true');
 await page.locator('#shootMark').click();
 assert.equal(await page.locator('#shootCount').textContent(),'已拍 0 / 3');
 for(const index of [0,1,2]){await page.locator('[data-shot-index="'+index+'"]').click();await page.locator('#shootMark').click();}
 assert.equal(await page.locator('#shootComplete').isVisible(),true);
 assert.equal(await page.locator('#shootNext').isDisabled(),true);
 await page.locator('#shootMark').click();
 assert.equal(await page.locator('#shootComplete').isVisible(),false);
 await page.keyboard.press('ArrowLeft');
 assert.equal(await page.locator('#shootPosition').textContent(),'02 / 03');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>document.getElementById('motionToggle').disabled);
 await page.keyboard.press('ArrowRight');
 assert.equal(await page.locator('#shootDialog').evaluate(el=>el.getAnimations({subtree:true}).length),0);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('[data-shoot-size="large"]').click();
 await page.locator('[data-shot-index="0"]').click();
 await page.screenshot({path:join(artifactDir,'shooting.png'),animations:'disabled'});
 for(const [width,height] of [[390,844],[320,568],[844,390],[1440,1000]]){
  await page.setViewportSize({width,height});
  await page.locator('[data-shoot-size="extra"]').click();
  assert.ok(await page.locator('#shootDialog').evaluate(el=>el.scrollWidth<=innerWidth),'dialog width at '+width);
  assert.ok(await page.locator('#shootMark').evaluate(el=>{const box=el.getBoundingClientRect();return box.top>=0 && box.bottom<=innerHeight}),'shooting controls visible at '+width+'x'+height);
  assert.ok(await page.locator('#shootBody').evaluate(el=>el.clientHeight>80),'reading area at '+width+'x'+height);
  await page.locator('#shootBody').evaluate(el=>{el.scrollTop=el.scrollHeight});
  if(width===390)await page.screenshot({path:join(artifactDir,'shooting-mobile.png'),animations:'disabled'});
 }
 await page.keyboard.press('Escape');
 // Opening from the full script returns to that modal, with its controls still usable.
 await page.locator('#scriptList [data-viewscript="101"]').click();
 await page.locator('#modalShoot').click();
 assert.equal(await page.locator('#shootDialog').evaluate(el=>el.matches(':modal')),true);
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#modal').evaluate(el=>el.matches(':modal')),true);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'modalShoot');
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{fixture.scripts[0].content+='\n新版拍摄说明。'});
 await page.locator('[data-shoot-script="101"]').click();
 assert.equal(await page.locator('#shootChanged').isVisible(),true);
 assert.equal(await page.locator('#shootPosition').textContent(),'01 / 03');
 assert.equal(await page.locator('#shootCount').textContent(),'已拍 0 / 3');
 await page.keyboard.press('Escape');
 await page.locator('[data-shoot-script="102"]').click();
 assert.match(await page.locator('#shootFormat').textContent(),/原文分段/);
 assert.equal(await page.locator('#shootCount').textContent(),'已完成 0 / 3');
 await page.locator('#shootMark').click();
 await page.keyboard.press('Escape');
 // Script isolation and unavailable storage: no fabricated save success or uncaught error.
 await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('Simulated storage denial')}});
 await page.locator('[data-shoot-script="101"]').click();
 assert.match(await page.locator('#shootStorage').textContent(),/本次页面打开期间/);
 assert.equal(await page.locator('#shootCount').textContent(),'已拍 0 / 3');
 await page.locator('#shootNext').click();await page.locator('#shootMark').click();
 await page.keyboard.press('Escape');
 await page.locator('[data-shoot-script="101"]').click();
 assert.equal(await page.locator('#shootPosition').textContent(),'02 / 03');
 assert.equal(await page.locator('#shootCount').textContent(),'已拍 1 / 3');
 // Closing during a step transition clears child animations immediately.
 await page.evaluate(()=>{document.getElementById('shootNext').click();document.getElementById('shootClose').click()});
 assert.equal(await page.locator('#shootDialog').evaluate(el=>el.getAnimations({subtree:true}).length),0);
 // Escape only closes the topmost modal, leaving an underlying pending confirmation intact.
 await page.evaluate(()=>{fixture.scripts[1].content='这是最好的美甲。'});
 await page.locator('#scriptList [data-viewscript="102"]').click();
 await page.locator('#modalFix').click();
 await page.locator('#modalShoot').click();
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#shootDialog').isVisible(),false);
 assert.equal(await page.locator('#modal .confirm-bar').isVisible(),true);
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#modal .confirm-bar').count(),0);
 await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>window.fixtureWrites||0),0);
 assert.deepEqual(errors,[]);
 if(process.env.STUDIO_RECORD_DEMO==='1'){
  const demo=await browser.newPage({viewport:{width:1440,height:1000},recordVideo:{dir:artifactDir,size:{width:1440,height:1000}}});
  await prepare(demo,{origin,records,errors});
  await demo.locator('.tab[data-view="scripts"]').click();await demo.waitForTimeout(700);
  await demo.locator('[data-shoot-script="101"]').click();await demo.waitForTimeout(1200);
  await demo.locator('#shootMark').click();await demo.waitForTimeout(650);
  await demo.locator('#shootNext').click();await demo.waitForTimeout(1100);
  await demo.locator('[data-shoot-size="extra"]').click();await demo.waitForTimeout(750);
  await demo.locator('#shootMark').click();await demo.waitForTimeout(600);
  await demo.locator('#shootNext').click();await demo.waitForTimeout(1000);
  await demo.locator('#shootMark').click();await demo.waitForTimeout(900);
  await demo.keyboard.press('Escape');await demo.waitForTimeout(700);
  await demo.locator('[data-shoot-script="101"]').click();await demo.waitForTimeout(1000);
  const video=demo.video();await demo.close();await video.saveAs(join(artifactDir,'shooting.webm'));await video.delete();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: storyboard reading, text fallback, empty scripts, marking/undo, independent navigation, three font sizes, reload restoration, revision reset, script isolation, storage denial, modal focus/return, reduced motion, mobile/landscape controls, zero cloud writes.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
