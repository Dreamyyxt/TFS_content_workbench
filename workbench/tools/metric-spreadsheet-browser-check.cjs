// Uses only isolated cloud fixtures. Optional METRIC_EXPORT_FIXTURE is read locally;
// its contents are never saved in screenshots, logs, the repository, or production.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const XLSX=require('../vendor/xlsx-0.20.3.min.js'),P=require('../metric-spreadsheet');
const {fixture}=require('./studio-fixture.cjs');
const origin=process.env.STUDIO_URL||'http://127.0.0.1:4318';
const dir=process.env.STUDIO_ARTIFACT_DIR||'/private/tmp/tfs-metric-spreadsheet';fs.mkdirSync(dir,{recursive:true});
const headers=['作品名称','发布时间','体裁','审核状态','播放量','完播率','5s完播率','封面点击率','2s跳出率','平均播放时长','点赞量','分享量','评论量','收藏量','主页访问量','粉丝增量'];
const makeRow=(name,date,views=120)=>[name,date,'图文','公开',views,0.125,0.333333,'-',0.444444,3.888889,8,2,0,5,6,1];
function book(rows){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([headers,...rows]),'作品列表');return Buffer.from(XLSX.write(wb,{type:'array',bookType:'xlsx'}));}
const xhsHeaders=['笔记标题','首次发布时间','体裁','曝光','观看量','封面点击率','点赞','评论','收藏','涨粉','分享','人均观看时长','弹幕'];
function xhsBook(views=26){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
 Array(13).fill('最多导出排序后前1000条笔记'),xhsHeaders,
 ['自然光里的琥珀猫眼','2026年10月18日21时42分35秒','图文',328,views,0.079,1,0,2,0,0,4,3],
 ['试色日记：一层与两层的区别','2026年10月20日08时00分00秒','视频',500,80,0.16,4,2,3,1,2,6.5,0]
 ]),'Sheet1');return Buffer.from(XLSX.write(wb,{type:'array',bookType:'xlsx'}));}
const baseRows=[makeRow('自然光里的琥珀猫眼','2026-10-18 21:42:35'),makeRow('短甲也适合的细法式','2026-10-17 18:30:00',80)];
const upload=(page,buffer,name='作品列表导出.xlsx')=>page.locator('#metricFileInput').setInputFiles({name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const records=structuredClone(fixture);records.video_metrics=[];
 const writes=[],errors=[],unexpected=[];let sequence=0,failRead=false,failAt=0,attempt=0;
 const page=await browser.newPage({viewport:{width:1500,height:1100},timezoneId:'America/Los_Angeles'});
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('metricFixtureQuery',async({table,mode,patch,filters,limit})=>{
  if(mode==='select'&&table==='video_metrics'&&failRead){failRead=false;return {data:null,error:{message:'模拟读取失败'}};}
  let rows=(records[table]||[]).filter(r=>filters.every(([key,value])=>r[key]===value));
  if(mode!=='select'){
   if(table!=='video_metrics')throw Error('Unexpected write '+table);attempt++;
   if(failAt===attempt)return {data:null,error:{message:'模拟保存失败'}};
   writes.push({mode,patch});
   if(mode==='insert'){rows=[{...patch,id:'import-'+(++sequence)}];records[table].push(...rows);}
   else if(mode==='update')rows.forEach(r=>Object.assign(r,patch));
   else throw Error('Unexpected delete');
  }
  if(limit)rows=rows.slice(0,limit);return {data:structuredClone(rows),error:null};
 });
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(url.includes('cdn.jsdelivr.net'))return route.fulfill({contentType:'application/javascript',body:`window.WorkBuddyCloud={createWorkBuddyCloud:()=>({database:{from(table){let mode='select',patch=null,filters=[],limit;const q={select(){return q},order(){return q},limit(n){limit=n;return q},eq(k,v){filters.push([k,v]);return q},insert(p){mode='insert';patch=p;return q},update(p){mode='update';patch=p;return q},then(resolve,reject){return window.metricFixtureQuery({table,mode,patch,filters,limit}).then(resolve,reject)}};return q}},llm:{models:{list:async()=>[]}}})};`});
  if(url.startsWith(origin+'/'))return route.continue();if(url.startsWith('http://127.0.0.1:4191/'))return route.abort();unexpected.push(url);return route.abort();
 });
 await page.goto(origin);await page.locator('#syncState.is-ok').waitFor();await page.locator('.tab[data-view="data"]').click();await page.locator('#btnOpenMetricFile').click();
 await upload(page,book(baseRows));await page.waitForFunction(()=>document.getElementById('metricFileStatus').textContent.includes('请选择这份'));
 assert.equal(await page.locator('#btnConfirmMetricFile').isEnabled(),false);assert.equal(writes.length,0);
 await page.locator('#metricFileAccount').selectOption('抖音官方号');await page.waitForFunction(()=>document.getElementById('btnConfirmMetricFile').textContent==='确认导入 2 条'&&!document.getElementById('btnConfirmMetricFile').disabled);
 assert.ok((await page.locator('#metricFileRows').textContent()).includes('33.33%'));assert.equal(writes.length,0);
 for(const width of [1500,1080,768,390,360]){
  await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'overflow at '+width);
  if(width===1500||width===390)await page.locator('#metricFilePanel').screenshot({path:path.join(dir,'preview-'+width+'.png'),animations:'disabled'});
 }
 await page.setViewportSize({width:1500,height:1100});await page.locator('#btnConfirmMetricFile').click();
 await page.waitForFunction(()=>document.getElementById('metricFileStatus').textContent.includes('导入完成'));
 assert.equal(records.video_metrics.length,2);assert.equal(records.video_metrics[0].finish_5s,33.3333);assert.equal(records.video_metrics[0].finish_3s,null);
 assert.ok((await page.locator('#metricFileSummary').textContent()).includes('跳过 2'));assert.equal(await page.locator('#btnConfirmMetricFile').isEnabled(),false);
 // Repeat upload does not write; updating is explicit and preserves manual fields.
 await upload(page,book(baseRows));await page.waitForFunction(()=>document.getElementById('metricFileSummary').textContent.includes('跳过 2'));assert.equal(writes.length,2);
 const old=records.video_metrics[0];old.dms=9;old.schedule_id=42;old.finish_3s=45;old.note=P.pack('活动投放备注',P.unpack(old.note).source);
 const updated=[makeRow(baseRows[0][0],baseRows[0][1],500),baseRows[1]];await upload(page,book(updated));await page.locator('#metricFileMode').selectOption('update');
 await page.waitForFunction(()=>document.getElementById('btnConfirmMetricFile').textContent==='确认导入 2 条'&&!document.getElementById('btnConfirmMetricFile').disabled);
 await page.locator('[data-import-line="3"]').uncheck();await page.locator('#btnConfirmMetricFile').click();await page.waitForFunction(()=>document.getElementById('metricFileStatus').textContent.includes('导入完成'));
 assert.equal(old.views,500);assert.equal(old.dms,9);assert.equal(old.schedule_id,42);assert.equal(old.finish_3s,45);assert.equal(P.unpack(old.note).note,'活动投放备注');assert.equal(writes.length,3);
 await page.locator('#btnCloseMetricFile').click();await page.locator('[data-editmetric="'+old.id+'"]').click();assert.equal(await page.locator('#mNote').inputValue(),'活动投放备注');
 await page.locator('#mNote').fill('手动修改备注');await page.locator('#btnSaveMetric').click();await page.locator('#metricForm').waitFor({state:'hidden'});
 assert.equal(P.unpack(old.note).note,'手动修改备注');assert.equal(P.unpack(old.note).source.extra.completion_rate,12.5);
 await page.locator('[data-metric-id="'+old.id+'"] .metric-export-details summary').click();assert.ok((await page.locator('[data-metric-id="'+old.id+'"] .metric-export-details').textContent()).includes('3.89 秒'));
 // Same file, different bound account: independent records, no mixed metrics.
 await page.locator('#btnOpenMetricFile').click();await page.locator('#metricFileMode').selectOption('skip');await page.locator('#metricFileAccount').selectOption('老板IP号');await upload(page,book(baseRows));
 await page.waitForFunction(()=>document.getElementById('btnConfirmMetricFile').textContent==='确认导入 2 条'&&!document.getElementById('btnConfirmMetricFile').disabled);
 await page.locator('#btnConfirmMetricFile').click();await page.waitForFunction(()=>document.getElementById('metricFileStatus').textContent.includes('导入完成'));
 assert.equal(records.video_metrics.filter(r=>r.account==='老板IP号').length,2);
 // Partial save / retry; a read failure blocks writes until a successful recheck.
 const other=[makeRow('新作品一','2026-10-19 18:30:00'),makeRow('新作品二','2026-10-19 19:30:00')];await upload(page,book(other));
 await page.waitForFunction(()=>document.getElementById('btnConfirmMetricFile').textContent==='确认导入 2 条'&&!document.getElementById('btnConfirmMetricFile').disabled);
 failAt=attempt+2;await page.locator('#btnConfirmMetricFile').click();await page.waitForFunction(()=>document.getElementById('metricFileStatus').textContent.includes('已停止'));
 assert.equal(records.video_metrics.filter(r=>r.account==='老板IP号').length,3);assert.ok((await page.locator('#metricFileSummary').textContent()).includes('新增 1'));
 failRead=true;const before=writes.length;await page.locator('#btnRefreshMetricFile').click();await page.waitForFunction(()=>document.getElementById('metricFileStatus').textContent.includes('无法核对'));assert.equal(await page.locator('#btnConfirmMetricFile').isEnabled(),false);assert.equal(writes.length,before);
 await page.locator('#btnRefreshMetricFile').click();await page.waitForFunction(()=>document.getElementById('btnConfirmMetricFile').textContent==='确认导入 1 条'&&!document.getElementById('btnConfirmMetricFile').disabled);
 await page.locator('#btnConfirmMetricFile').click();await page.waitForFunction(()=>document.getElementById('metricFileStatus').textContent.includes('导入完成'));assert.equal(records.video_metrics.filter(r=>r.account==='老板IP号').length,4);
 // Xiaohongshu uses the same entry, detects platform, and requires rebinding after a platform change.
 await upload(page,xhsBook(),'笔记列表明细表.xlsx');await page.waitForFunction(()=>document.getElementById('metricFileStatus').textContent.includes('已识别为小红书'));
 assert.equal(await page.locator('#metricFileAccount').inputValue(),'');assert.equal(await page.locator('#btnConfirmMetricFile').isEnabled(),false);
 const options=await page.locator('#metricFileAccount option').evaluateAll(nodes=>nodes.map(n=>n.value));
 assert.ok(options.includes('小红书官方号'));assert.ok(options.includes('老板IP号'));assert.ok(!options.includes('抖音官方号'));
 await page.locator('#metricFileAccount').selectOption('老板IP号');await page.waitForFunction(()=>document.getElementById('btnConfirmMetricFile').textContent==='确认导入 2 条'&&!document.getElementById('btnConfirmMetricFile').disabled);
 assert.equal(await page.locator('#metricFileMetric1Heading').textContent(),'曝光');assert.equal(await page.locator('#metricFileMetric2Heading').textContent(),'封面点击率');
 assert.ok((await page.locator('#metricFileRows').textContent()).includes('7.90%'));assert.ok(!(await page.locator('#metricFileRows').textContent()).includes('5 秒完播'));
 await page.locator('#metricFileRows details').first().locator('summary').click();
 assert.ok((await page.locator('#metricFileRows').textContent()).includes('弹幕：3'));assert.ok((await page.locator('#metricFileRows').textContent()).includes('人均观看时长：4.00 秒'));
 for(const width of [1500,1080,768,390,360]){
  await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'XHS overflow at '+width);
  if(width===1500||width===390)await page.locator('#metricFilePanel').screenshot({path:path.join(dir,'xiaohongshu-'+width+'.png'),animations:'disabled'});
 }
 await page.setViewportSize({width:1500,height:1100});await page.locator('#btnConfirmMetricFile').click();await page.waitForFunction(()=>document.getElementById('metricFileStatus').textContent.includes('导入完成'));
 const xhsRecords=records.video_metrics.filter(r=>r.account==='老板IP号'&&r.platform==='小红书');assert.equal(xhsRecords.length,2);assert.equal(records.video_metrics.filter(r=>r.account==='老板IP号'&&r.platform==='抖音').length,4);
 const xhsOld=xhsRecords[0];assert.equal(xhsOld.impressions,328);assert.equal(xhsOld.finish_3s,null);assert.equal(xhsOld.finish_5s,null);assert.equal(P.unpack(xhsOld.note).source.extra.danmaku,3);
 assert.ok((await page.locator('#metricFileSummary').textContent()).includes('跳过 2'));
 xhsOld.note=P.pack('小红书备注',P.unpack(xhsOld.note).source);xhsOld.dms=5;
 await upload(page,xhsBook(60),'笔记列表明细表.xlsx');await page.locator('#metricFileMode').selectOption('update');await page.waitForFunction(()=>document.getElementById('btnConfirmMetricFile').textContent==='确认导入 2 条'&&!document.getElementById('btnConfirmMetricFile').disabled);
 await page.locator('#btnConfirmMetricFile').click();await page.waitForFunction(()=>document.getElementById('metricFileStatus').textContent.includes('导入完成'));
 assert.equal(xhsOld.views,60);assert.equal(xhsOld.dms,5);assert.equal(P.unpack(xhsOld.note).note,'小红书备注');
 assert.equal(records.video_metrics.find(r=>r.account==='老板IP号'&&r.platform==='抖音'&&r.title===xhsOld.title).views,120);
 await page.locator('#btnCloseMetricFile').click();await page.locator('[data-editmetric="'+xhsOld.id+'"]').click();assert.equal(await page.locator('#mNote').inputValue(),'小红书备注');
 await page.locator('#mNote').fill('小红书手动修改');await page.locator('#btnSaveMetric').click();await page.locator('#metricForm').waitFor({state:'hidden'});
 assert.equal(P.unpack(xhsOld.note).note,'小红书手动修改');assert.equal(P.unpack(xhsOld.note).source.extra.danmaku,3);
 await page.locator('[data-metric-id="'+xhsOld.id+'"] .metric-export-details summary').click();const details=await page.locator('[data-metric-id="'+xhsOld.id+'"] .metric-export-details').textContent();assert.ok(details.includes('弹幕：3'));assert.ok(details.includes('曝光：328'));assert.ok(details.includes('观看量：60'));assert.ok(!details.includes('完整完播率'));
 await page.locator('#btnOpenMetricFile').click();await page.locator('#metricFileMode').selectOption('skip');
 // Switching back removes an incompatible XHS account and restores the Douyin columns.
 await page.locator('#metricFileAccount').selectOption('小红书官方号');await upload(page,book(baseRows));await page.waitForFunction(()=>document.getElementById('metricFileStatus').textContent.includes('已识别为抖音'));
 assert.equal(await page.locator('#metricFileAccount').inputValue(),'');assert.equal(await page.locator('#metricFileViewsHeading').textContent(),'播放量');assert.equal(await page.locator('#metricFileAccount option[value="小红书官方号"]').count(),0);
 await page.locator('#metricFileAccount').selectOption('老板IP号');
 // Malformed file clears the old ready state. Closing prevents stale preview restoration.
 await upload(page,Buffer.from('invalid'));await page.waitForFunction(()=>document.getElementById('metricFileStatus').textContent.includes('不是有效'));
 assert.equal(await page.locator('#btnConfirmMetricFile').isEnabled(),false);assert.equal(await page.locator('#metricFilePreview').isVisible(),false);
 for(const fixturePath of [process.env.METRIC_EXPORT_FIXTURE,process.env.XHS_EXPORT_FIXTURE].filter(Boolean)){
  const actual=fs.readFileSync(fixturePath),expected=P.parse(actual,XLSX),beforeActual=writes.length;
  await upload(page,actual);await page.waitForFunction(count=>document.getElementById('metricFileSummary').textContent.startsWith('共 '+count+' 条'),expected.count);
  if(!await page.locator('#metricFileAccount').inputValue())await page.locator('#metricFileAccount').selectOption('老板IP号');
  await page.waitForFunction(count=>document.querySelectorAll('#metricFileRows tr').length===count,expected.rows.length);
  assert.equal(await page.locator('#metricFileRows tr').count(),expected.rows.length);assert.equal(writes.length,beforeActual);
  console.log('Real workbook local browser preview:',expected.rows.length,'valid rows,',expected.errors.length,'invalid; zero writes.');
 }
 await page.locator('#btnCloseMetricFile').click();assert.equal(await page.locator('#metricFilePanel').isVisible(),false);
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 console.log('PASS: local worker, account required, 5 widths, explicit import/update, selection, repeat skip, cross-account/platform isolation, Xiaohongshu import/update and metrics, platform switching, note/extra retention, partial retry, read failure and malformed file. Cloud is mocked.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
