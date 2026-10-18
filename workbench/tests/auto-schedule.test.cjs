const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync(require.resolve('../app'),'utf8');
function run(start,weeks=3,count=19,perWeek=5){
 const items=Array.from({length:count},(_,i)=>({id:i+1,account:'测试账号',title:'内容'+i,batch_id:'b'}));
 const c={S:{busy:false,materials:items},pendingMaterials:()=>items,latestBatch:()=> 'b',
  $:id=>({value:id==='#schedStart'?start:String(weeks)}),ACCOUNTS:[{name:'测试账号',platform:'抖音',perWeek}],
  PLATFORM_SLOTS:{抖音:['11:50','18:30','21:10']},ACC_BY_NAME:{测试账号:{platform:'抖音'}},
  scriptForMaterial:id=>id===1?{id:101}:null,opsName:()=> 'fixture',toast:()=>{},};
 vm.createContext(c);
 vm.runInContext(app.slice(app.indexOf('function pad('),app.indexOf('/* localStorage'))+app.slice(app.indexOf('function autoSchedule(){'),app.indexOf('async function runAutoSchedule()'))+'globalThis.result=autoSchedule();',c);
 return c.result?.rows;
}
test('Saturday start never assigns shooting before Oct 17; publication follows shooting and account cadence',()=>{
 const rows=run('2026-10-17');assert.equal(rows.length,19);
 assert.equal(rows.map(r=>r.shoot_date).sort()[0],'2026-10-20');
 const dates=new Set();for(const row of rows){
  assert.ok(row.shoot_date>='2026-10-17');assert.ok(row.publish_at.slice(0,10)>row.shoot_date);
  assert.ok(!dates.has(row.publish_at.slice(0,10)));dates.add(row.publish_at.slice(0,10));
  assert.equal(row.platform,'抖音');assert.match(row.publish_at,/\+08:00$/);
 }
 assert.equal(rows.find(r=>r.material_id===1).script_id,101);
});
test('all weekdays, year/month boundaries, 1–3 weeks and account rates preserve date bounds',()=>{
 for(const start of ['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18','2026-12-31','2028-02-29']){
  for(const weeks of [1,2,3])for(const rate of [1,3,7]){
   const rows=run(start,weeks,35,rate);assert.equal(rows.length,35);
   const end=new Date(start+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+weeks*7);
   for(const r of rows){assert.ok(r.shoot_date>=start);assert.ok(r.shoot_date<end.toISOString().slice(0,10));assert.ok([2,5].includes(new Date(r.shoot_date+'T00:00:00Z').getUTCDay()));assert.ok(r.publish_at.slice(0,10)>r.shoot_date);}
   assert.equal(new Set(rows.map(r=>r.publish_at.slice(0,10))).size,35);
  }
 }
});
test('invalid dates do not produce a plan',()=>{for(const date of ['invalid','2026-02-30','2026-13-01'])assert.equal(run(date),undefined);});
