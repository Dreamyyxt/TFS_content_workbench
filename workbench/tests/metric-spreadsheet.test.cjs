const test=require('node:test'),assert=require('node:assert/strict');
const XLSX=require('../vendor/xlsx-0.20.3.min.js'),P=require('../metric-spreadsheet');
const headings=['作品名称','发布时间','体裁','审核状态','播放量','完播率','5s完播率','封面点击率','2s跳出率','平均播放时长','点赞量','分享量','评论量','收藏量','主页访问量','粉丝增量'];
const record=(name='测试作品',time='2026-10-18 21:42:35')=>[name,time,'1min-视频','公开','20','0.058824','0.333333','-','0.444444','3.888889','1','0','0','0','0','0'];
function file(rows=[record()],edit=()=>{}){const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([headings,...rows]);edit(ws,wb);XLSX.utils.book_append_sheet(wb,ws,'作品列表');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
const parse=(rows,edit)=>P.parse(file(rows,edit),XLSX);
function existing(row,account='抖音官方号',id=1){return {id,...P.payload(row,account,'test'),dms:8,groupon_redeemed:2,schedule_id:9,video_url:'https://example.test/video',finish_3s:44};}
test('matches actual export layout: ratios, zero, missing values, all extras and exact timestamp',()=>{
 const x=parse().rows[0];assert.equal(x.fields.finish_5s,33.3333);assert.equal(x.fields.views,20);assert.equal(x.fields.followers_gain,0);
 assert.ok(!('finish_3s' in x.fields));assert.ok(!('impressions' in x.fields));assert.equal(x.source.extra.completion_rate,5.8824);assert.ok(!('cover_click_rate' in x.source.extra));assert.equal(x.source.extra.avg_watch_seconds,3.888889);assert.equal(x.source.extra.profile_visits,0);assert.equal(x.source.published_at,'2026-10-18 21:42:35');
 const insert=P.payload(x,'A','test');assert.equal(insert.finish_3s,null);assert.equal(insert.impressions,null);assert.equal(insert.dms,null);
});
test('supports percentages and Excel numeric dates without timezone drift, rejects invalid and formula rows',()=>{
 const r=record();r[6]='33.33%';r[15]='-2';
 const x=parse([r],ws=>{ws.B2={t:'n',v:46313.5,z:'yyyy-mm-dd hh:mm:ss'};});assert.equal(x.rows[0].fields.finish_5s,33.33);assert.equal(x.rows[0].fields.followers_gain,-2);assert.equal(x.rows[0].source.published_at,'2026-10-18 12:00:00');
 const invalid=record();invalid[1]='2026-02-30 12:00:00';assert.equal(parse([invalid]).errors.length,1);
 const formula=parse([record()],ws=>{ws.E2={t:'n',v:20,f:'SUM(1,19)'};});assert.equal(formula.rows.length,0);assert.match(formula.errors[0].message,/公式/);
 const negative=record();negative[4]='-1';assert.equal(parse([negative]).errors.length,1);
 for(const value of ['1.2万','NaN','12,34',true])assert.throws(()=>P.numeric(value,'count'));
 assert.equal(P.numeric('1,234','count'),1234);assert.equal(P.numeric('100%','rate'),100);assert.equal(P.numeric('0','rate'),0);
});
test('keeps images, visibility states, blank and invalid rows explicit; validates workbook layout and sizes',()=>{
 const pic=record('图文');pic[2]='图文';pic[3]='不适宜公开';pic[6]='-';
 const x=parse([pic,[],['没有时间']]);assert.equal(x.rows.length,1);assert.equal(x.errors.length,1);assert.equal(x.count,2);assert.equal(x.rows[0].source.review_status,'不适宜公开');assert.ok(!('finish_5s'in x.rows[0].fields));
 assert.throws(()=>P.parse(Buffer.from('not xlsx'),XLSX));
 assert.throws(()=>P.validateZip(new Uint8Array(P.MAX_BYTES+1)),/10 MB/);
 assert.throws(()=>parse([record()],ws=>{ws.B1.v='不是发布日期';}),/未找到/);
 assert.throws(()=>parse([record()],ws=>{ws.Q1={t:'s',v:'播放量'};ws['!ref']='A1:Q2';}),/重复列名/);
});
test('repeat imports are scoped by account and platform, updates patch only available fields',()=>{
 const x=parse().rows[0],old=existing(x);old.note=P.pack('人工备注',P.unpack(old.note).source);
 assert.equal(P.plan([x],[old],'抖音官方号')[0].action,'skip');assert.equal(P.plan([x],[old],'其他抖音账号')[0].action,'insert');
 assert.equal(P.plan([x],[{...old,platform:'小红书'}],'抖音官方号')[0].action,'insert');
 const patch=P.payload(P.plan([x],[old],'抖音官方号','update')[0],'抖音官方号','operator');
 assert.equal(P.unpack(patch.note).note,'人工备注');for(const field of ['dms','groupon_redeemed','finish_3s','schedule_id','video_url'])assert.ok(!(field in patch));
 assert.equal(P.plan([x],[{...old,note:''}],'抖音官方号')[0].action,'conflict');
 assert.equal(P.plan([x],[old,{...old,id:2}],'抖音官方号')[0].action,'conflict');
 const renamed={...x,fields:{...x.fields,title:'改过标题'},source:{...x.source,original_title:'改过标题'}};
 assert.equal(P.plan([renamed],[old],'抖音官方号')[0].action,'conflict');
});
test('duplicate input rows are skipped; conflicting snapshots of one work require review',()=>{
 const x=parse([record(),record()]).rows;assert.deepEqual(P.plan(x,[],'A').map(r=>r.action),['insert','skip']);
 x[1].fields.views=999;assert.deepEqual(P.plan(x,[],'A').map(r=>r.action),['conflict','conflict']);
 assert.throws(()=>P.plan(x,[],''),/选择/);
});
test('metadata survives manual note edits and preserves extras omitted in a later export',()=>{
 const x=parse().rows[0],old=existing(x);const next={...x,source:{...x.source,extra:{completion_rate:10}}};
 const p=P.payload(P.plan([next],[old],'抖音官方号','update')[0],'抖音官方号','test');
 assert.equal(P.unpack(p.note).source.extra.avg_watch_seconds,3.888889);
 const edited=P.pack('改为真实备注',P.unpack(p.note).source);assert.equal(P.unpack(edited).note,'改为真实备注');assert.equal(P.unpack(edited).source.extra.completion_rate,10);
 assert.equal(P.unpack('普通备注').source,null);assert.equal(P.unpack('普通备注').note,'普通备注');
});
test('commit rechecks remote state, stops on uncertain writes and retry does not duplicate successful rows',async()=>{
 const rows=parse([record('一'),record('二','2026-10-18 22:00:00'),record('三','2026-10-19 12:00:00')]).rows,db=[];let calls=0;
 const args={account:'A',operator:'test',readExisting:async()=>db,write:async(action,payload)=>{calls++;db.push({id:calls,...payload});if(calls===2)throw Error('网络中断，写入结果未知');}};
 const first=await P.commit(rows,args);assert.equal(first.saved,1);assert.equal(first.failedLine,3);assert.equal(db.length,2);
 const retry=await P.commit(rows,args);assert.equal(retry.saved,1);assert.equal(retry.skipped,2);assert.equal(db.length,3);
 await assert.rejects(()=>P.commit(rows,{...args,readExisting:async()=>{throw Error('read failed');}}),/read failed/);
 assert.equal(db.length,3);
});
test('capacity is checked before any write, avoiding incomplete duplicate scans',async()=>{
 const rows=parse().rows;let writes=0;
 await assert.rejects(()=>P.commit(rows,{account:'A',readExisting:async()=>Array.from({length:999},(_,id)=>({id,account:'A',platform:'抖音'})),write:async()=>{writes++;}}),/1000/);assert.equal(writes,0);
});
test('ZIP metadata bounds reject excessive expansion and encrypted archives before parsing',()=>{
 const bytes=Buffer.from(file()),central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));assert.ok(central>=0);
 const bomb=Buffer.from(bytes);bomb.writeUInt32LE(40*1024*1024,central+24);assert.throws(()=>P.validateZip(bomb),/过大/);
 const encrypted=Buffer.from(bytes);encrypted.writeUInt16LE(1,central+8);assert.throws(()=>P.validateZip(encrypted),/加密/);
});
