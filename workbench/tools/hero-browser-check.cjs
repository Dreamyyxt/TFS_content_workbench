const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const {mkdirSync}=require('node:fs');
const {join}=require('node:path');
const {prepare}=require('./studio-fixture.cjs');
const origin=process.env.STUDIO_URL || 'http://127.0.0.1:4318';
const dir=process.env.STUDIO_ARTIFACT_DIR || '/private/tmp/tfs-hero-check';
mkdirSync(dir,{recursive:true});
const nodes={materials:'.node-top-left',scripts:'.node-top-right',video:'.node-bottom-left',schedule:'.node-bottom-right'};
const labels={materials:'风口选题',scripts:'拍摄辅助',video:'视频制作',schedule:'发布日历'};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const errors=[];
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2});
 await prepare(page,{origin,errors});
 const core=page.locator('.creative-core');
 function assertAim(){return page.evaluate(()=>{
  const core=document.querySelector('.creative-core');
  const target=document.querySelector('.network-node[data-route="'+core.dataset.module+'"] .node-orb').getBoundingClientRect();
  const center=core.getBoundingClientRect();
  const expected=Math.atan2(target.top+target.height/2-center.top-center.height/2,target.left+target.width/2-center.left-center.width/2)*180/Math.PI;
  const actual=Math.atan2(parseFloat(core.style.getPropertyValue('--glow-y')),parseFloat(core.style.getPropertyValue('--glow-x')))*180/Math.PI;
  return Math.abs(((actual-expected+180)%360+360)%360-180);
 });}
 const poses=[];
 for(const [route,selector] of Object.entries(nodes)){
  await page.locator(selector).hover();
  assert.equal(await core.getAttribute('data-module'),route);
  assert.equal(await page.locator('#coreModuleLabel').textContent(),labels[route]);
  assert.equal(await page.locator('[data-network-route="'+route+'"].is-linked').count(),2);
  assert.equal(await page.locator('.network-node.is-linked').count(),1);
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.core-track').evaluate(el=>getComputedStyle(el).rotate),'none','frame stays fixed');
  assert.equal(await page.locator('.core-track').evaluate(el=>getComputedStyle(el,'::before').content),'none','no ambiguous opposing arcs');
  assert.ok(await assertAim()<5,'direction must point toward '+route);
  poses.push(await page.locator('.orb-form').evaluate(el=>getComputedStyle(el).transform));
  await page.locator('.creative-network').screenshot({path:join(dir,route+'.png'),animations:'disabled'});
 }
 assert.equal(new Set(poses).size,4,'modules must produce visibly different sculpture poses');
 // Pointer hover takes over from stale keyboard focus; Tab takes control back.
 await page.locator('.node-top-left').focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
 assert.equal(await core.getAttribute('data-module'),'materials');
 await page.locator('.node-top-right').hover();
 assert.equal(await core.getAttribute('data-module'),'scripts');
 await page.keyboard.press('Tab');
 assert.equal(await core.getAttribute('data-module'),'scripts');
 await page.keyboard.press('Shift+Tab');
 assert.equal(await core.getAttribute('data-module'),'materials');
 // Rapid changes cancel the old response instead of piling up ripples.
 await page.locator('.node-top-left').hover();
 await page.locator('.node-bottom-left').hover();
 await page.locator('.node-bottom-right').hover();
 assert.equal(await core.getAttribute('data-module'),'schedule');
 assert.ok(await page.locator('.core-response').evaluate(el=>el.getAnimations().length)<=1);
 assert.ok(await page.locator('.orb-center').evaluate(el=>el.getAnimations().filter(a=>a.constructor.name==='Animation').length)<=1);
 await page.waitForTimeout(1250);
 assert.equal(await page.locator('.core-response').evaluate(el=>getComputedStyle(el).opacity),'0');
 assert.equal(await page.locator('.core-response').evaluate(el=>el.getAnimations().length),0);
 for(const width of [1024,768,390,320]){
  await page.setViewportSize({width,height:900});
  await page.locator('.node-bottom-right').hover();await page.waitForTimeout(700);
  assert.ok(await assertAim()<6,'direction after resizing at '+width);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow at '+width);
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('#motionToggle').focus();await page.mouse.move(2,2);
 await page.waitForFunction(()=>document.querySelector('.creative-core').dataset.module==='');
 assert.equal(await page.locator('#coreModuleLabel').textContent(),'灵感，在这里生长');
 assert.equal(await page.locator('.network-flow.is-linked').count(),0);
 await page.locator('#motionToggle').click();
 await page.locator('.node-top-right').hover();
 assert.equal(await core.getAttribute('data-module'),'scripts');
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
 await page.locator('#motionToggle').click();
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>document.getElementById('motionToggle').disabled);
 await page.locator('.node-top-left').hover();
 assert.equal(await core.getAttribute('data-module'),'materials');
 assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('.node-top-right').click();
 assert.equal(await page.locator('#view-scripts').isVisible(),true,'navigation must stay immediate');
 assert.equal(await page.locator('.orb-petals').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
 assert.equal(await core.getAttribute('data-module'),'');
 assert.equal(await page.evaluate(()=>window.fixtureWrites||0),0);
 // Standalone demo uses the same component and motion module without any HTTP requests.
 const demo=await browser.newPage({viewport:{width:1440,height:900},recordVideo:process.env.STUDIO_RECORD_DEMO==='1'?{dir,size:{width:1440,height:900}}:undefined});
 const requests=[];demo.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())});demo.on('pageerror',error=>errors.push(error.message));
 await demo.goto('file://'+join(process.cwd(),'outputs/studio-hero/preview.html'));
 await demo.locator('.node-top-left').hover();
 assert.equal(await demo.locator('.creative-core').getAttribute('data-module'),'materials');
 await demo.locator('.node-top-left').click();
 assert.equal(await demo.locator('#view-home').isVisible(),true);
 for(const route of ['materials','scripts','video','schedule']){
  await demo.locator(nodes[route]).hover();
  if(process.env.STUDIO_RECORD_DEMO==='1')await demo.waitForTimeout(route==='video'?2600:1700);
 }
 await demo.locator('#motionToggle').click();
 assert.equal(await demo.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
 await demo.locator('#motionToggle').click();
 assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
 const video=demo.video();await demo.close();if(video){await video.saveAs(join(dir,'hero.webm'));await video.delete();}
 const mobileDemo=await browser.newPage();
 mobileDemo.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())});
 mobileDemo.on('pageerror',error=>errors.push(error.message));
 await mobileDemo.goto('file://'+join(process.cwd(),'outputs/studio-hero/preview.html'));
 for(const width of [390,320]){
  await mobileDemo.setViewportSize({width,height:900});
  await mobileDemo.locator('.node-top-right').click();
  assert.equal(await mobileDemo.locator('.creative-core').getAttribute('data-module'),'scripts');
  assert.ok(await mobileDemo.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await mobileDemo.close();assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
 console.log('PASS: four module poses and matching paths, measured direction, fixed frame and single cancellable ripple, mixed keyboard/pointer priority, responsive aim, breathing pause, reduced motion, immediate navigation, no cloud writes, offline interactive preview.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
