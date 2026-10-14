// Isolated fixture and SDK for browser acceptance; all external requests are blocked.
const fixture={
 materials:Array.from({length:8},(_,i)=>({id:i+1,account:['抖音官方号','小红书官方号','老板IP号','店铺日常号'][i%4],title:['秋日指尖，留一点温柔的琥珀色','短甲也能拥有的法式松弛感','开店十二年，我坚持的小事','收店前的十分钟，治愈一天'][i%4],batch_id:'batch-1',selected:i<3,content_form:'实拍',goal:'收藏',angle:'让款式自己说话',hook:'阳光照在指尖上的这一刻，刚刚好。',keywords:'秋冬美甲,猫眼,静安区美甲',trend_reason:'以真实作品细节回应换季配色需求。',priority:i===0?'high':'normal'})),
 scripts:[{id:101,material_id:1,account:'抖音官方号',title:'秋日指尖，留一点温柔的琥珀色',content:'## 拍摄脚本\n\n0–3秒：展示琥珀猫眼在日光下的光泽。\n3–12秒：转换角度，展示甲型与细节。',created_at:'2026-10-13T02:00:00Z'}],
 schedules:[{id:'p0',script_id:101,material_id:1,account:'抖音官方号',title:'秋日指尖，留一点温柔的琥珀色',plan_batch:'p1',publish_at:'2026-10-14T18:30:00+08:00',publish_slot:'18:30',shoot_date:'2026-10-13',status:'planned'}],
 video_metrics:Array.from({length:14},(_,i)=>({id:'v'+i,account:i%2?'小红书官方号':'抖音官方号',title:'秋日美甲作品 '+(i+1),platform:i%2?'小红书':'抖音',publish_date:'2026-10-'+String(7+Math.floor(i/2)).padStart(2,'0'),views:700+i*193,finish_3s:i%2?60:30,finish_5s:28,likes:80+i*5,comments:12,saves:50,shares:8,groupon_redeemed:2})),
 trend_snapshots:[{id:'t0',source:'seed',summary:'让温暖的棕色、琥珀与微光走进秋日。用真实上手效果和款式细节，回应顾客的换季需求。',keywords:'秋冬美甲,琥珀猫眼,静安区美甲',created_at:'2026-10-13T02:00:00Z',payload:{}}],store_profile:[]
};
async function prepare(target,{origin,records=fixture,errors=[]}){
 const page=target;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*', async route=>{
  const url=route.request().url();
  if(url.includes('cdn.jsdelivr.net')) return route.fulfill({contentType:'application/javascript',body:`window.WorkBuddyCloud={createWorkBuddyCloud:()=>({database:{from:table=>{let rows=window.fixture[table]||[];let patch=null;const q={select(){return q},order(){return q},limit(){return q},eq(key,value){rows=rows.filter(r=>r[key]===value);return q},update(p){patch=p;return q},then(resolve,reject){return (async()=>{if(patch){window.fixtureWrites=(window.fixtureWrites||0)+1;const control=window.fixtureControl||{};if(table==='materials'){control.calls=(control.calls||0)+1;if(control.delay)await new Promise(r=>setTimeout(r,control.delay));if(control.throwIds?.some(id=>rows.some(r=>r.id===id)))throw new Error('Simulated transport failure');if(control.failIds?.some(id=>rows.some(r=>r.id===id)))return {data:[],error:{message:'Simulated SDK failure'}};if(control.emptyIds?.some(id=>rows.some(r=>r.id===id)))return {data:[],error:null};}rows.forEach(r=>Object.assign(r,patch));}return {data:rows,error:null}})().then(resolve,reject)}};return q}},llm:{models:{list:async()=>[{id:'test-model',name:'测试模型',maxInputTokens:1000,maxOutputTokens:1000}]}}})};`});
  if(url.startsWith(origin+'/'))return route.continue();
  return route.abort();
 });
 await page.addInitScript(f=>{window.fixture=f},records);
 await page.goto(origin);
 await page.locator('#syncState.is-ok').waitFor({timeout:10000});
 }

module.exports={fixture,prepare};
