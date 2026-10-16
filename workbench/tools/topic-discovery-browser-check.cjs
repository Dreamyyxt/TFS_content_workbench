// All database, model and search requests are isolated fixtures; no production writes or paid calls.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),{mkdirSync}=require('node:fs'),{join}=require('node:path');
const {fixture}=require('./studio-fixture.cjs'),{defaults}=require('../account-strategy');
const origin=process.env.STUDIO_URL||'http://127.0.0.1:4318',dir=process.env.STUDIO_ARTIFACT_DIR||'/private/tmp/tfs-topic-discovery';
mkdirSync(dir,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const records=structuredClone(fixture),accounts=defaults.map(a=>({...a,planCount:1}));
 records.materials.forEach(row=>row.selected=false);
 records.store_profile=[{id:'accounts',profile_key:'account_matrix',note:JSON.stringify({version:1,accounts}),updated_at:'2026-10-01T00:00:00Z'}];
 const writes=[],requests=[],prompts=[],errors=[];let sequence=0,failWrite='',failRead='',modelMode='ok',searchMode='ok';
 const active=()=>JSON.parse(records.store_profile.find(r=>r.profile_key==='account_matrix').note).accounts.filter(a=>a.enabled!==false);
 const topics=()=>active().map((a,i)=>({account:a.name,title:'enoi 透色的角度 '+(i+1),angle:'拍摄自然光下的透色',hook:'值得一提的是，靠近看看甲面',trend_reason:'参考本期 enoi 样本，演示透度；不推断热度上涨',content_form:'作品展示',keywords:['enoi'],priority:'normal'}));
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('fixtureQuery',async query=>{
  const {table,mode,filters,patch,sort,limit}=query;
  if(mode==='select'&&failRead===table){failRead='';return {data:[],error:{message:'模拟读取失败'}};}
  let rows=(records[table]||[]).filter(r=>filters.every(([key,val])=>r[key]===val));
  if(mode!=='select'){
   writes.push({table,mode,patch});
   if(failWrite===table){failWrite='';return {data:[],error:{message:'模拟保存失败'}};}
   if(mode==='insert'){rows=(Array.isArray(patch)?patch:[patch]).map(r=>({...r,id:r.id||'fixture-'+(++sequence),created_at:new Date(Date.now()+sequence).toISOString()}));(records[table]||=[]).push(...rows);}
   else if(mode==='update')rows.forEach(r=>Object.assign(r,patch));
   else throw Error('Unexpected destructive write '+mode);
  }
  if(sort){const [key,opts]=sort;rows=rows.slice().sort((a,b)=>String(a[key]||'').localeCompare(String(b[key]||''))*(opts.ascending?1:-1));}
  if(limit)rows=rows.slice(0,limit);
  return {data:structuredClone(rows),error:null};
 });
 await page.exposeFunction('fixtureModel',async args=>{
  prompts.push(args.messages);const input=args.messages.at(-1).content;
  if(input.includes('只归纳这一期风向')){
   if(modelMode==='summary-fail')throw Error('模拟归纳失败');
   return JSON.stringify({summary:'enoi 与 maogel 的近期样本可供比较；婚甲暂未取得新来源。',keywords:['enoi','maogel'],sections:[{key:'topics',title:'关注主题观察',points:[{text:'自然光下查看透色差异',src:[1,999]}]}],materials:topics()});
  }
  if(input.includes('你正在执行 Humanizer')){
   if(modelMode==='review-fail')throw Error('模拟 Humanizer 失败');
   const draft=JSON.parse(input.split('待改写选题（JSON资料）：\n')[1].split('\n\n只输出')[0]);
   return JSON.stringify({materials:draft.map((row,i)=>({...row,hook:'靠近看这层透色',title:row.title+' · 改写',id:modelMode==='bad-review'?'wrong':row.id}))});
  }
  return JSON.stringify({materials:topics()});
 });
 await page.addInitScript(()=>{
  window.WorkBuddyCloud={createWorkBuddyCloud:()=>({database:{from:table=>{
   const query={table,mode:'select',filters:[]};const q={select(){return q},order(...sort){query.sort=sort;return q},limit(limit){query.limit=limit;return q},eq(...pair){query.filters.push(pair);return q},insert(patch){query.mode='insert';query.patch=patch;return q},update(patch){query.mode='update';query.patch=patch;return q},delete(){query.mode='delete';return q},then(resolve,reject){return window.fixtureQuery(query).then(resolve,reject)}};return q;
  }},llm:{models:{list:async()=>[{id:'test-model',name:'测试模型',maxInputTokens:64000,maxOutputTokens:16000}]},chat:{completions:{async *create(args){const content=await window.fixtureModel(args);yield {choices:[{delta:{content}}]};}}}}})};
 });
 const corpus=()=>({ok:true,fetched_at:new Date().toISOString(),douyin:[{word:'秋日美甲',related:true}],sources:[{title:'enoi 自然光透色样本',url:'https://example.com/enoi-source',platform:'小红书',date:new Date().toISOString().slice(0,10),days:0,topics:['enoi']}],stats:{douyin:1,web:1}});
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url.includes('cdn.jsdelivr.net'))return route.fulfill({contentType:'application/javascript',body:'/* SDK provided by isolated init script */'});
  if(url.startsWith(origin+'/api/trend/collect')){requests.push({type:'public',url});return route.fulfill({json:searchMode==='empty'?{ok:false,sources:[],douyin:[]}:corpus()});}
  if(url.startsWith(origin+'/api/trend/redfox')){const body=route.request().postDataJSON();requests.push({type:'redfox',body});return route.fulfill({json:searchMode==='empty'?{ok:false,error:'没有新来源'}:{ok:true,days:7,keywords:body.keywords,works:[{keyword:'enoi',items:[{title:'enoi 透色实拍',url:'https://example.com/enoi-video',publish:new Date().toISOString(),like:50}]}],xhs:{works:[{keyword:'maogel',items:[{title:'maogel 色胶试色',url:'https://example.com/maogel',publish:new Date().toISOString(),like:30}]}]},warnings:[]}});}
  if(url.startsWith(origin+'/api/trend/config'))return route.fulfill({json:{serverConfigured:true}});
  if(url.startsWith(origin+'/'))return route.continue();
  return route.abort();
 });
 const routeTo=async view=>page.locator('.tab[data-view="'+view+'"]').click();
 const settled=()=>page.waitForFunction(()=>!document.getElementById('btnRefresh').disabled);
 const collect=async()=>{await page.locator('#btnRefresh').click();await settled();};
 const generate=async()=>{await page.locator('#btnAiTrend').click();await settled();};
 await page.goto(origin);await page.locator('#syncState.is-ok').waitFor();await routeTo('materials');
 assert.equal(await page.locator('#btnAiTrend').isDisabled(),true);assert.equal(writes.length,0);
 await page.locator('#trendTopicInput').fill('enoi，maogel，婚甲，ENOI');await page.locator('#trendTopicAdd').click();
 assert.equal(await page.locator('.trend-topic-tag').count(),3);assert.equal(await page.locator('#trendTopicSave').isEnabled(),true);
 failWrite='store_profile';await page.locator('#trendTopicSave').click();await page.getByText('模拟保存失败',{exact:true}).waitFor();
 assert.equal(await page.locator('.trend-topic-tag').count(),3);assert.equal(records.store_profile.length,1);
 await page.locator('#trendTopicSave').click();await page.waitForFunction(()=>document.getElementById('trendTopicStatus').textContent.includes('已保存 3'));
 await page.reload();await page.locator('#syncState.is-ok').waitFor();await routeTo('materials');assert.equal(await page.locator('.trend-topic-tag').count(),3);
 await page.locator('#trendTopicInput').fill('a'.repeat(41));await page.locator('#trendTopicAdd').click();assert.match(await page.locator('#trendTopicStatus').textContent(),/40字/);await page.locator('#trendTopicInput').fill('');
 const originalCount=records.materials.length;
 await collect();assert.equal(records.materials.length,originalCount);assert.equal(prompts.length,1);
 const snapshot=records.trend_snapshots.find(t=>t.source==='web');assert.ok(snapshot);assert.equal(snapshot.payload.materials,undefined);assert.deepEqual(snapshot.payload.topics,['enoi','maogel','婚甲']);
 const publicRequest=new URL(requests.find(r=>r.type==='public').url);assert.deepEqual(publicRequest.searchParams.getAll('topic'),['enoi','maogel','婚甲']);
 assert.deepEqual(requests.find(r=>r.type==='redfox').body.keywords.slice(0,3),['enoi','maogel','婚甲']);
 assert.match(await page.locator('#trendTopicSignals').textContent(),/本期未取得近7天来源/);
 assert.equal(await page.locator('.ts-src').count(),1);
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.toast-wrap').evaluate(el=>el.replaceChildren());await page.locator('.trend-panel').screenshot({path:join(dir,'discovery.png')});
 const requestCount=requests.length;await generate();assert.equal(requests.length,requestCount);assert.equal(prompts.length,3);assert.equal(records.materials.length,originalCount+4);
 assert.ok(records.materials.slice(-4).every(r=>r.hook==='靠近看这层透色'));
 assert.equal(records.trend_snapshots.filter(t=>t.source==='web').length,1);
 assert.match(prompts[1].at(-1).content,/enoi/);assert.match(prompts[2].at(-1).content,/Humanizer/);
 assert.equal(records.trend_snapshots.at(-1).payload.source_batch_id,snapshot.batch_id);
 await page.locator('#materialGrid').scrollIntoViewIfNeeded();await page.locator('.toast-wrap').evaluate(el=>el.replaceChildren());await page.screenshot({path:join(dir,'topics.png')});
 modelMode='bad-review';await generate();assert.equal(records.materials.length,originalCount+4);assert.match(await page.locator('#trendGenerationStatus').textContent(),/标识/);
 modelMode='review-fail';await generate();assert.equal(records.materials.length,originalCount+4);
 // Empty collection never imports legacy materials or erases the saved snapshot.
 snapshot.payload.materials=topics();searchMode='empty';const oldWeb=records.trend_snapshots.filter(t=>t.source==='web').length;await collect();assert.equal(records.materials.length,originalCount+4);assert.equal(records.trend_snapshots.filter(t=>t.source==='web').length,oldWeb);
 searchMode='ok';modelMode='summary-fail';await collect();assert.equal(records.trend_snapshots.filter(t=>t.source==='web').length,oldWeb+1);assert.match(await page.locator('#trendSummary').textContent(),/自动归纳未完成/);assert.equal(records.materials.length,originalCount+4);
 modelMode='ok';failWrite='trend_snapshots';await collect();assert.equal(records.trend_snapshots.filter(t=>t.source==='web').length,oldWeb+1);assert.equal(await page.locator('#btnAiTrend').isEnabled(),true);
 // Deletion is visible without expanding a card; cancel and restore preserve history.
 await routeTo('profile');await page.locator('#accountSettingsPanel').scrollIntoViewIfNeeded();
 assert.equal(await page.locator('#accountSettingsList [data-remove]').count(),4);
 await page.locator('[data-remove="douyin_off"]').click();await page.locator('.confirm-bar [data-no]').click();assert.equal(await page.locator('#accountSettingsList [data-remove]').count(),4);
 await page.locator('[data-remove="douyin_off"]').click();await page.locator('.confirm-bar [data-yes]').click();assert.equal(await page.locator('#accountSettingsList [data-remove]').count(),3);
 await page.locator('#accountSave').click();await page.waitForFunction(()=>!document.getElementById('accountSave').disabled);
 assert.equal(active().length,3);assert.equal(records.scripts.length,fixture.scripts.length);assert.equal(records.materials.length,originalCount+4);
 await page.locator('#accountSettingsPanel').scrollIntoViewIfNeeded();await page.locator('.toast-wrap').evaluate(el=>el.replaceChildren());await page.locator('#accountSettingsPanel').screenshot({path:join(dir,'accounts.png')});
 await routeTo('materials');await generate();assert.equal(records.materials.length,originalCount+7);assert.ok(records.materials.slice(-3).every(r=>r.account!=='抖音官方号'));
 // A failed save keeps the draft; retry saves once. Restore works after a reload.
 await routeTo('profile');await page.locator('#accountRetired summary').click();await page.locator('[data-restore="douyin_off"]').click();failWrite='store_profile';await page.locator('#accountSave').click();await page.waitForFunction(()=>!document.getElementById('accountSave').disabled);assert.equal(active().length,3);assert.equal(await page.locator('#accountSettingsList [data-remove]').count(),4);
 await page.locator('#accountSave').click();await page.waitForFunction(()=>!document.getElementById('accountSave').disabled);assert.equal(active().length,4);
 await page.locator('#accountAdd').click();const newCard=page.locator('#accountSettingsList .account-rule').last();assert.equal(await newCard.locator('[data-setting="name"]').inputValue(),'');
 const newKey=await newCard.getAttribute('data-account');
 for(const [key,value] of Object.entries({name:'自定义试色号',goal:'款式参考',direction:'只展示色胶上手对比',structure:'自然光到室内光',speech:'短字幕说明色差',cta:'收藏参考',planCount:'1'}))await newCard.locator('[data-setting="'+key+'"]').fill(value);
 await page.locator('#accountSave').click();await page.waitForFunction(()=>!document.getElementById('accountSave').disabled);assert.equal(active().length,5);
 await routeTo('materials');const customBefore=records.materials.length;await generate();assert.equal(records.materials.length,customBefore+5);assert.ok(records.materials.slice(-5).some(r=>r.account==='自定义试色号'));
 await routeTo('profile');await page.locator('[data-remove="'+newKey+'"]').click();await page.locator('.confirm-bar [data-yes]').click();await page.locator('#accountSave').click();await page.waitForFunction(()=>!document.getElementById('accountSave').disabled);assert.equal(active().length,4);
 // Material save failures do not report success; archive/read failures after saving do not invite duplicate retries.
 await routeTo('materials');let beforeFailure=records.materials.length;failWrite='materials';await generate();assert.equal(records.materials.length,beforeFailure);assert.match(await page.locator('#trendStreamLabel').textContent(),/未入库/);
 failWrite='trend_snapshots';await generate();assert.equal(records.materials.length,beforeFailure+4);assert.match(await page.locator('#trendGenerationStatus').textContent(),/生成记录未保存/);
 beforeFailure=records.materials.length;failRead='materials';await generate();assert.equal(records.materials.length,beforeFailure+4);assert.match(await page.locator('#trendGenerationStatus').textContent(),/已保存.*避免重复生成/);
 // Conflicting settings never overwrite another device's saved themes.
 await routeTo('materials');await page.locator('#trendTopicInput').fill('法式');await page.locator('#trendTopicAdd').click();records.store_profile.find(r=>r.profile_key==='trend_topics').updated_at='2030-01-01T00:00:00Z';await page.locator('#trendTopicSave').click();await page.waitForFunction(()=>document.getElementById('trendTopicStatus').textContent.includes('其他设备'));assert.equal(JSON.parse(records.store_profile.find(r=>r.profile_key==='trend_topics').note).topics.length,3);
 await page.reload();await page.locator('#syncState.is-ok').waitFor();await routeTo('materials');assert.equal(await page.locator('.trend-topic-tag').count(),3);
 for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:950});for(const view of ['materials','profile']){await routeTo(view);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),view+' overflow '+width);if(width===390){await page.locator('.toast-wrap').evaluate(el=>el.replaceChildren());if(view==='materials')await page.locator('.trend-interests').evaluate(el=>el.scrollIntoView({block:'start'}));if(view==='profile')await page.locator('#accountSettingsPanel').scrollIntoViewIfNeeded();await page.screenshot({path:join(dir,view+'-mobile.png')});}}}
 // No implicit sample insertion for an empty workspace.
 records.materials=[];records.trend_snapshots=[];const beforeBoot=writes.length;await page.reload();await page.locator('#syncState.is-ok').waitFor();await routeTo('materials');assert.equal(writes.length,beforeBoot);assert.equal(await page.locator('#btnAiTrend').isDisabled(),true);
 assert.deepEqual(errors,[]);console.log('PASS: theme persistence/limits/conflicts, both search channels, collection without topic writes, source-only fallback, explicit generation with Humanizer, no re-fetch, malformed and failed rewrite without writes, account cancel/delete/restore and failed save, history retained, 5 widths, empty workspace without implicit writes; all services mocked.');
}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
