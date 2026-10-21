const test=require('node:test'),assert=require('node:assert/strict');
const {parseLink,count,dateKey,normalize,importMetric}=require('../metric-import');
const dy=parseLink('看看这个作品 https://www.douyin.com/video/123456789。'),xhs=parseLink('https://www.xiaohongshu.com/explore/abc?xsec_token=demo');
test('extracts a single share link; rejects arbitrary hosts, credentials, multiple links and profile pages',()=>{
 assert.equal(dy.platform,'douyin');assert.equal(parseLink('分享 https://xhslink.cn/o/abc 来看看').platform,'xiaohongshu');
 assert.ok(xhs.url.includes('xsec_token=demo'));
 for(const url of ['http://127.0.0.1/admin','https://www.douyin.com.evil.test/video/1','https://www.douyin.com@evil.test/a','https://xhslink.cn:8080/a','https://www.douyin.com/user/123','https://www.xiaohongshu.com/user/profile/123','https://xhslink.cn/a https://xhslink.cn/b','https://xiaohongshu.com/'])assert.throws(()=>parseLink(url));
});
test('maps work metrics, preserves genuine zero and ignores author totals/private stats/play placeholders',()=>{
 const r=normalize({code:2000,data:{title:'一条作品',publishTime:'2026-10-17 20:30:00',likeCount:0,commentCount:'42',collectCount:null,shareCount:'1.2万',playCount:0,author:{likeCount:90000},finish_3s:99,impressions:999}},dy);
 assert.equal(r.fields.likes,0);assert.equal(r.fields.comments,42);assert.equal(r.fields.publish_date,'2026-10-17');
 for(const key of ['saves','shares','views','finish_3s','impressions','followers_gain'])assert.ok(!(key in r.fields));
 assert.equal(r.fields.title,'一条作品');
});
test('supports XHS work-level fields and nested platform interaction details without guessing missing counts',()=>{
 const a=normalize({workTitle:'图文笔记',workLikedCount:'11',workCommentsCount:'0',workCollectedCount:7,workSharedCount:3,workPublishTime:'2026-10-17'},xhs).fields;
 assert.deepEqual([a.likes,a.comments,a.saves,a.shares],[11,0,7,3]);assert.equal(a.platform,'小红书');
 const b=normalize({data:{note_card:{title:'笔记',interact_info:{liked_count:'5',collected_count:'1万',comment_count:false}}}},xhs).fields;
 assert.equal(b.likes,5);assert.ok(!('saves'in b));assert.ok(!('comments'in b));
 assert.throws(()=>normalize({data:{author:{likeCount:10000}}},dy));
 for(const p of [{code:3201,data:{title:'error'}},{error:'failed'},[],{data:[]},{success:false}])assert.throws(()=>normalize(p,dy));
});
test('only exact nonnegative counts are accepted and dates use Shanghai timezone',()=>{
 for(const n of [null,undefined,'',true,-1,1.2,'1.2万','999+','unknown','Infinity'])assert.equal(count(n),null);
 assert.equal(count('0'),0);assert.equal(dateKey('2026-02-30'),null);assert.equal(dateKey('2026-10-17T17:30:00Z'),'2026-10-18');assert.equal(dateKey(1792252800),'2026-10-18');
});
test('calls verified MCP tools with the URL, without visiting user supplied addresses',async()=>{
 const calls=[];const transport={open:async(p,k)=>{calls.push([p,k]);return 'sid';},call:async(...args)=>{calls.push(args);return {title:'作品'};}};
 await importMetric(dy.url,'fixture-key',transport);assert.deepEqual(calls[1].slice(0,5),['douyin','fixture-key','sid','douyin_get_work',{work_url:dy.url}]);
 calls.length=0;await importMetric(xhs.url,'fixture-key',transport);assert.equal(calls[1][3],'xiaohongshu_get_work');assert.deepEqual(calls[1][4],{work_link:xhs.url});
 calls.length=0;await assert.rejects(()=>importMetric('http://localhost/private','fixture-key',transport));assert.equal(calls.length,0);
});
test('HTTP route rejects invalid input and cross-site requests; reports missing credentials without upstream calls',async t=>{
 const oldKey=process.env.REDFOX_API_KEY,oldLocal=process.env.JY_LOCAL;
 process.env.REDFOX_API_KEY='';process.env.JY_LOCAL='0';
 const {server}=require('../server');
 if(oldKey===undefined)delete process.env.REDFOX_API_KEY;else process.env.REDFOX_API_KEY=oldKey;
 if(oldLocal===undefined)delete process.env.JY_LOCAL;else process.env.JY_LOCAL=oldLocal;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 const send=(url,headers={})=>fetch(origin+'/api/metrics/import',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({url})});
 assert.equal((await fetch(origin+'/api/metrics/import')).status,405);
 assert.equal((await send('http://127.0.0.1/private')).status,400);
 assert.equal((await send(dy.url,{Origin:'https://untrusted.example'})).status,403);
 const missing=await send(dy.url,{Origin:origin});assert.equal(missing.status,401);assert.equal((await missing.json()).need_key,true);
 assert.equal((await fetch(origin+'/metric-import.js')).status,404);
});
