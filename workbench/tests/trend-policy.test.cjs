const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policy=require('../trend-policy');
test('freshness rejects stale, unknown and future dates; normalizes unix timestamps and deduplicates',()=>{
 const now=Date.parse('2026-10-10T12:00:00Z');const r=policy.filter([{url:'a',publish:now/1000},{url:'a',publish:now},{url:'old',publish:'2025-10-10'},{url:'unknown',publish:''},{url:'future',publish:now+86400000}],7,now);
 assert.equal(r.items.length,1);assert.equal(r.old,1);assert.equal(r.unknown,1);assert.equal(r.future,1);assert.equal(r.items[0].publish,new Date(now).toISOString());
});
test('account keyword selection uses saved terms and skips disabled accounts',()=>{
 assert.deepEqual(policy.keywords([{direction:'口播行业'},{direction:'打扫搞笑'},{searchKeywords:'静安美甲，通勤甲',direction:'产品'},{enabled:false,searchKeywords:'不采集'}]),['美甲店经营','美甲行业','美甲店日常','美甲店搞笑','静安美甲','通勤甲']);
});
test('cache isolates credentials, coalesces requests and never caches failures',async()=>{
 const cache=policy.createCache();let calls=0;const run=async()=>{calls++;return {ok:true};};await Promise.all([cache('a',run),cache('a',run)]);assert.equal(calls,1);assert.equal((await cache('a',run)).cached,true);await cache('b',run);assert.equal(calls,2);const fail=async()=>{calls++;return {ok:false};};await cache('c',fail);await cache('c',fail);assert.equal(calls,4);
});
test('season anchors pick up nearby holidays and always reserve keyword slots for them',()=>{
 const s=policy.seasons('2026-10-10');
 assert.equal(s.season,'秋季');
 assert.ok(s.active.some(x=>x.name==='秋季'));
 assert.ok(s.upcoming.some(x=>x.name==='万圣节'));
 assert.ok(policy.seasons('2026-10-31').active.some(x=>x.name==='万圣节'));
 assert.ok(policy.seasons('2026-11-05').active.some(x=>x.name==='双11大促'));
 assert.ok(policy.seasons('2026-10-20').active.some(x=>x.name==='万圣节'));
 const kw=policy.searchKeywords([{direction:'口播行业'}],'2026-10-10');
 assert.ok(kw.includes('美甲店经营'));
 assert.ok(kw.includes('万圣节美甲'));
 assert.ok(kw.length<=11);
 const crowded=policy.searchKeywords(Array.from({length:12},(_,i)=>({searchKeywords:'词'+i})),'2026-10-10');
 assert.ok(crowded.includes('秋季美甲'));
 assert.ok(crowded.length<=11);
});
test('redfox survives tool failure via REST, filters before ranking and reports partial platforms',async()=>{
 const source=fs.readFileSync(require.resolve('../server'),'utf8');const from=source.indexOf('async function collectRedfox('),to=source.indexOf('/* =========================================================================',from);const progress=[];
 const context={TrendPolicy:policy,REDFOX_KEYWORDS:['美甲'],mcpOpen:async()=>'',dySearchWorksMcp:async()=>{throw Error('tool unavailable');},redfoxSearch:async()=>[{title:'new',url:'a',publish:new Date().toISOString()},{title:'old',url:'b',publish:'2020-01-01'}],xhsSearchWorksMcp:async()=>{throw Error('xhs unavailable');},xhsHotwordsMcp:async()=>{throw Error('hot unavailable');},sleep:async()=>{},shortErr:e=>e.message,distillTopicHotwords:()=>[]};vm.createContext(context);vm.runInContext(source.slice(from,to)+';globalThis.run=collectRedfox;',context);const r=await context.run('test',{days:7},p=>progress.push(p));assert.equal(r.ok,true);assert.equal(r.dy_channel,'rest');assert.equal(r.total_works,1);assert.equal(r.dropped.old,1);assert.equal(r.platforms.xiaohongshu.status,'partial');assert.ok(r.warnings.length);assert.ok(progress.some(p=>p.platform==='小红书'));
});
test('frontend still requests redfox after free-source failure and passes valid redfox sources to model',async()=>{
 const app=fs.readFileSync(require.resolve('../app'),'utf8');const start=app.indexOf('async function collectWebTrend(){'),end=app.indexOf('    let json=TrendPolicy.digest',start);
 let requested=false,modelCorpus=null;const nodes={};const context={S:{busy:false,topicSettingsLoaded:true,trendTopics:['enoi']},$:(id)=>nodes[id]||(nodes[id]={value:''}),setSync:()=>{},URLSearchParams,renderTrendWorkflow:()=>{},saveTrendTopics:async()=>{},fetch:async()=>{throw Error('free source down');},console:{warn:()=>{}},TrendPolicy:policy,AccountStrategy:{getConfig:()=>[]},fetchRedfox:async()=>{requested=true;return {ok:true};},mergeRedfox:c=>{c.sources=[{url:'https://example.com'}];return {works:1,xhs_works:0,warnings:[]};},syncWebTrendCore:async()=>{throw Error('should not fallback');},toast:()=>{},MODEL_ID:'test'};vm.createContext(context);vm.runInContext(app.slice(start,end)+'globalThis.output=corpus;}finally{S.busy=false;}}globalThis.run=collectWebTrend;',context);await context.run();assert.equal(requested,true);assert.equal(context.output.sources.length,1);
});

test('custom topics are normalized, prioritized, and included in public queries with bounded input',()=>{
 assert.deepEqual(policy.normalizeTopics('#enoi， ENOI，maogel、婚甲'),['enoi','maogel','婚甲']);
 assert.throws(()=>policy.normalizeTopics(Array.from({length:9},(_,i)=>'主题'+i)),/最多/);
 assert.throws(()=>policy.normalizeTopics(['a'.repeat(41)]),/40/);
 assert.throws(()=>policy.normalizeTopics([{}]),/文字/);
 const topics=Array.from({length:8},(_,i)=>'主题'+i);
 const words=policy.searchKeywords([{searchKeywords:'账号关键词'}],'2026-10-10',16,topics);
 assert.deepEqual(words.slice(0,8),topics);assert.ok(words.includes('账号关键词'));assert.ok(words.includes('秋季美甲'));assert.ok(words.length<=16);
 assert.deepEqual(policy.topicQueries(['enoi']),[{q:'enoi 美甲',win:7,plat:'关注主题',tag:'关注 · enoi',topic:'enoi'}]);
});
test('topic signals distinguish recent query results from old, unknown, and empty evidence',()=>{
 const signals=policy.topicSignals(['enoi','maogel','婚甲'],[{url:'a',topics:['enoi'],days:1},{url:'a',topics:['enoi'],days:2},{url:'b',topics:['maogel'],days:80},{url:'c',topics:['maogel'],days:null}]);
 assert.deepEqual(signals,[{topic:'enoi',recent:1,total:1},{topic:'maogel',recent:0,total:2},{topic:'婚甲',recent:0,total:0}]);
 const summary=policy.digest({douyin:[],sources:[{title:'来源',url:'a'}],topics:['婚甲']});assert.ok(!('materials' in summary));assert.deepEqual(summary.keywords,[]);
});

test('public collection searches custom topics and preserves attribution when sources overlap',async()=>{
 const app=fs.readFileSync(require.resolve('../server'),'utf8'),start=app.indexOf('async function collectTrend('),end=app.indexOf('/* 联网体检',start);
 let plan;
 const context={TrendPolicy:policy,QUERY_PLAN:[],seasonQueries:()=>[],REF_KEYS:{},douyinHot:async()=>({list:[],src:'test'}),proDouyin:async()=>({on:false,items:[]}),proXhs:async()=>({on:false,items:[]}),judge:()=>({ok:true,date:'2026-10-16',days:0,bucket:{key:'d1',score:5,label:'今天'}}),searchAll:async p=>{plan=p;return {enginesUsed:['test'],results:p.map(item=>({title:'透色美甲的上手对比',snippet:'近期样本',url:'https://example.com/sample',domain:'xiaohongshu.com',plan:item}))};}};
 vm.createContext(context);vm.runInContext(app.slice(start,end)+';globalThis.run=collectTrend;',context);
 const result=await context.run({topics:['enoi','maogel']});assert.equal(plan.length,2);assert.ok(plan.every(p=>p.win===7));assert.equal(result.sources.length,1);assert.deepEqual([...result.sources[0].topics],['enoi','maogel']);
 await assert.rejects(context.run({topics:['a'.repeat(41)]}),/40字/);
});
