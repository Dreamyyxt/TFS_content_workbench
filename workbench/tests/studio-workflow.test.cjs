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

test('script sorting is stable, keeps unknown dates last, and does not mutate source order',()=>{
  const entries=[
    {script:{id:1,title:'B',created_at:'2026-10-13T16:30:00Z'}},
    {script:{id:2,title:'A',created_at:'2026-10-14T08:00:00+08:00'}},
    {script:{id:3,title:'C',created_at:'invalid'}},
    {script:{id:4,title:'D'}},
    {script:{id:5,title:'E',created_at:'2026-10-13T16:30:00Z'}}
  ];
  assert.deepEqual(flow.sortScripts(entries).map(e=>e.script.id),[2,1,5,3,4]);
  assert.deepEqual(flow.sortScripts(entries,'oldest').map(e=>e.script.id),[1,5,2,3,4]);
  assert.deepEqual(flow.sortScripts(entries,'title').map(e=>e.script.id),[2,1,3,4,5]);
  assert.deepEqual(entries.map(e=>e.script.id),[1,2,3,4,5]);
});

test('topic filters compose form, script state, selection and search without changing stored selection',()=>{
  const rows=[{id:1,account:'A',content_form:'实拍',selected:true,title:'琥珀',trend_reason:'换季需求'},
    {id:2,account:'A',content_form:'口播',selected:false,title:'日常'},
    {id:3,account:'旧账号',content_form:'实拍',selected:true,title:'门店',trend_reason:'换季需求'}];
  const scripts=[{material_id:'1'},{material_id:2}];const before=JSON.stringify(rows);
  assert.deepEqual(flow.filterMaterials(rows,scripts,{query:'换季',form:'实拍',status:'written',selectedOnly:true}).map(r=>r.id),[1]);
  assert.deepEqual(flow.filterMaterials(rows,scripts,{status:'unwritten',account:'旧账号'}).map(r=>r.id),[3]);
  assert.deepEqual(flow.filterMaterials(rows,scripts,{account:'A',form:'口播',status:'written'}).map(r=>r.id),[2]);
  assert.equal(flow.filterMaterials(rows,scripts,{form:'口播',selectedOnly:true}).length,0);
  assert.equal(JSON.stringify(rows),before);
});

test('analytics periods include today and the lower boundary, exclude future/invalid dates, and compose search',()=>{
  const rows=[{id:1,account:'A',publish_date:'2026-10-15',title:'琥珀'},
    {id:2,account:'A',publish_date:'2026-10-09',note:'换封面'},
    {id:3,account:'B',publish_date:'2026-10-08'},
    {id:4,account:'A',publish_date:'2026-09-16'},
    {id:5,publish_date:'2026-09-15'},{id:6,publish_date:'2026-10-16'},
    {id:7,publish_date:null},{id:8,publish_date:'2026-02-30'}];
  const before=JSON.stringify(rows),ids=options=>flow.filterMetrics(rows,{today:'2026-10-15',...options}).map(r=>r.id);
  assert.deepEqual(ids({period:'7'}),[1,2]);
  assert.deepEqual(ids({period:'30'}),[1,2,3,4]);
  assert.deepEqual(ids({period:'7',account:'A',query:' 换封面 '}),[2]);
  assert.deepEqual(ids({period:'undated'}),[7,8]);
  assert.equal(ids({period:'all'}).length,8);
  assert.equal(JSON.stringify(rows),before);
});

test('analytics sorting keeps missing measures last and real zeroes visible without changing source order',()=>{
  const rows=[{id:1,publish_date:'invalid',views:null,finish_3s:20},
    {id:2,publish_date:'2026-10-14',views:0,finish_3s:''},
    {id:3,publish_date:'2026-10-15',views:40,finish_3s:0},
    {id:4,publish_date:'2026-10-15',views:'40',finish_3s:60},
    {id:5,views:'invalid',finish_3s:null}];
  assert.deepEqual(flow.sortMetrics(rows).map(r=>r.id),[3,4,2,1,5]);
  assert.deepEqual(flow.sortMetrics(rows,'views').map(r=>r.id),[3,4,2,1,5]);
  assert.deepEqual(flow.sortMetrics(rows,'retention').map(r=>r.id),[4,1,3,2,5]);
  assert.deepEqual(rows.map(r=>r.id),[1,2,3,4,5]);
});

test('analytics traces only explicit schedule relationships and tolerates deleted source records',()=>{
  const scripts=[{id:10,material_id:20}],materials=[{id:20}];
  const plans=[{id:1,script_id:'10'},{id:2,material_id:20,script_id:999}];
  assert.deepEqual(flow.metricSource({schedule_id:'1'},plans,scripts,materials),{script:scripts[0],material:materials[0]});
  assert.deepEqual(flow.metricSource({schedule_id:2},plans,scripts,materials),{script:null,material:materials[0]});
  assert.deepEqual(flow.metricSource({schedule_id:999,title:'same title'},plans,scripts,materials),{script:null,material:null});
  assert.deepEqual(flow.metricSource({schedule_id:1},plans,[],[]),{script:null,material:null});
});

test('progress queues distinguish missing scripts, missing dates, due plans and actual metric links',()=>{
  const materials=[{id:1,selected:true},{id:2,selected:true},{id:3,selected:true},{id:4,selected:false}];
  const scripts=[{id:10,material_id:'1',content:'正文'},{id:20,material_id:2,content:'  '}];
  const plans=[{id:1,publish_at:'2026-10-15T11:00:00+08:00',shoot_date:'2026-10-14'},
    {id:2,publish_at:'2026-10-15T13:00:00+08:00',shoot_date:'2026-10-14'},
    {id:3,publish_at:'invalid',shoot_date:'2026-02-30'},
    {id:4,status:'published'},
    {id:5,publish_at:'2026-10-15T09:00:00+08:00'},
    {id:6,publish_at:'2026-10-15T12:00:00+08:00',shoot_date:'2026-10-14'}];
  const snapshot=JSON.stringify({materials,scripts,plans});
  const result=flow.progressQueues(materials,scripts,plans,[{schedule_id:'5'}],{now:Date.parse('2026-10-15T12:00:00+08:00')});
  assert.deepEqual(result.pending.map(row=>row.material.id),[2,3]);
  assert.equal(result.pending[0].script.id,20);assert.equal(result.pending[1].script,null);
  assert.deepEqual(result.dates.map(row=>row.id),[3]);
  assert.deepEqual(result.review.map(row=>row.id),[1,6,4]);
  assert.equal(JSON.stringify({materials,scripts,plans}),snapshot);
});
