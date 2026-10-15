const test=require('node:test');
const assert=require('node:assert/strict');
const flow=require('../studio-workflow.js');

test('Shanghai publishing days cross UTC midnight without depending on the device timezone',()=>{
  assert.equal(flow.dayKey('2026-10-13T16:30:00Z'),'2026-10-14');
  assert.equal(flow.dayKey('2026-10-14T00:30:00+08:00'),'2026-10-14');
  assert.equal(flow.dayKey('2026-10-14'),'2026-10-14');
  for(const value of [undefined,null,'','bad','2026-02-30'])assert.equal(flow.dayKey(value),'');
});

test('week navigation handles month/year boundaries and leap days',()=>{
  assert.deepEqual(flow.weekDays('2027-01-01'),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
  assert.equal(flow.shiftDay('2028-02-28',1),'2028-02-29');
  assert.equal(flow.shiftDay('2026-10-14',-7),'2026-10-07');
  assert.deepEqual(flow.weekDays('invalid'),[]);
});

test('calendar sorts real dates, excludes missing dates, and does not infer publication from a title or scheduled status',()=>{
  const rows=[{id:1,publish_at:'2026-10-14T18:00:00+08:00',status:'published'},{id:2,publish_at:'2026-10-14T09:00:00+08:00'},{id:3},{id:4,publish_at:'invalid'}];
  assert.deepEqual(flow.rowsOnDay(rows,'2026-10-14').map(r=>r.id),[2,1]);
  assert.equal(flow.metricForSchedule(rows[0],[{schedule_id:null,title:'same title'}]),null);
  assert.deepEqual(flow.metricForSchedule(rows[0],[{id:11,schedule_id:'1'}]),{id:11,schedule_id:'1'});
  assert.deepEqual(rows.map(r=>r.id),[1,2,3,4]);
});

test('script search composes account, body text, schedule and review filters',()=>{
  const entries=[
    {script:{id:1,account:'小红书',title:'琥珀猫眼',content:'聚光下的细节'},scan:{hits:[]},scheduled:true},
    {script:{id:2,account:'抖音',title:'门店日常',content:'开店准备'},scan:{hits:[{word:'最好'}]},scheduled:false},
    {script:{id:3,account:'小红书',title:'日常记录',content:'聚光下的工作台'},scan:{hits:[]},scheduled:false}
  ];
  assert.deepEqual(flow.filterScripts(entries,{query:' 聚光 ',account:'小红书',status:'unplanned'}).map(e=>e.script.id),[3]);
  assert.deepEqual(flow.filterScripts(entries,{status:'review'}).map(e=>e.script.id),[2]);
  assert.equal(flow.filterScripts(entries,{account:'抖音',status:'scheduled'}).length,0);
  assert.equal(flow.filterScripts(entries,{query:'不存在'}).length,0);
  assert.equal(flow.isScriptScheduled({id:1},[{script_id:'1'}]),true);
  assert.equal(flow.isScriptScheduled({id:2,material_id:1},[{script_id:1,material_id:1}]),false);
});

test('planning calendar separates shooting days and Shanghai publication days without hiding undated work',()=>{
  const rows=[{id:1,account:'A',shoot_date:'2026-10-13',publish_at:'2026-10-13T16:30:00Z',title:'后发'},
    {id:2,account:'A',shoot_date:'2026-10-13',publish_at:'2026-10-14T00:10:00+08:00',title:'先发'},
    {id:3,account:'B',shoot_date:'2026-10-16',publish_at:'invalid'},
    {id:4,account:'A',shoot_date:'2026-02-30',publish_at:'2026-10-21T09:00:00+08:00'}];
  const before=JSON.stringify(rows);
  const publish=flow.scheduleWeek(rows,{anchor:'2026-10-14',account:'A'});
  assert.deepEqual(publish.groups[2].rows.map(r=>r.id),[2,1]);
  assert.equal(publish.groups.flatMap(g=>g.rows).length,2);
  assert.equal(publish.undated.length,0);
  const shoot=flow.scheduleWeek(rows,{anchor:'2026-10-14',mode:'shoot',account:'A'});
  assert.deepEqual(shoot.groups[1].rows.map(r=>r.id),[2,1]);
  assert.deepEqual(shoot.undated.map(r=>r.id),[4]);
  assert.deepEqual(flow.scheduleWeek(rows,{anchor:'2026-10-14'}).undated.map(r=>r.id),[3]);
  assert.equal(JSON.stringify(rows),before);
});

test('nearest plan keeps the current week, then finds upcoming or most recent matching work',()=>{
  const rows=[{account:'A',publish_at:'2026-12-31'},{account:'A',publish_at:'2027-01-10'},{account:'B',publish_at:'2027-02-10'}];
  assert.equal(flow.nearestPlanDay(rows,{today:'2027-01-01'}),'2027-01-01');
  assert.equal(flow.nearestPlanDay(rows,{today:'2027-01-04',account:'A'}),'2027-01-04');
  assert.equal(flow.nearestPlanDay(rows,{today:'2026-12-20',account:'A'}),'2026-12-31');
  assert.equal(flow.nearestPlanDay(rows,{today:'2027-03-01',account:'A'}),'2027-01-10');
  assert.equal(flow.nearestPlanDay(rows,{today:'2027-01-01',account:'B'}),'2027-02-10');
  assert.equal(flow.nearestPlanDay([],{today:'2027-01-01'}),'2027-01-01');
  assert.deepEqual(flow.scheduleWeek(rows,{anchor:'2027-01-01'}).groups.map(g=>g.day),flow.weekDays('2027-01-01'));
});
