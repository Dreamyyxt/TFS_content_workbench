const test=require('node:test'),assert=require('node:assert/strict');const {validate}=require('../edit-plan');const C=require('../jy-catalog');
const assets=[{id:'a',type:'video'},{id:'b',type:'image'}];
test('edit plan preserves trims and repeated shots with exact integer boundaries',()=>{const p=validate({clips:[{asset_id:'a',source_start:2,duration:6.667},{asset_id:'b',duration:6.666},{asset_id:'a',duration:6.667}],narration:'口播'},assets,20);assert.equal(p.clips[0].source_start_us,2e6);assert.equal(p.clips[2].start_us+p.clips[2].duration_us,20e6);});
test('invalid references, durations and captions cannot reach Skill',()=>{for(const p of [{clips:[{asset_id:'x',duration:20}]},{clips:[{asset_id:'a',duration:-20}]},{clips:[{asset_id:'a',duration:10}]},{clips:[{asset_id:'a',duration:20}],captions:[{start:19,end:22,text:'字幕'}]}])assert.throws(()=>validate(p,assets,20));});

/* 真实事故回归：素材只有 6.68 秒，模型排了 7 秒的镜头。
   以前 validate 不做长度检查（因为拿到的素材表根本没有 duration），
   任务照样提交，直到本机执行器才报错。 */
const measured=[{id:'a',type:'video',name:'VID_221019.mp4',duration:10.175959},
                {id:'d',type:'video',name:'VID_220822.mp4',duration:9.491511},
                {id:'b',type:'video',name:'VID_220833.mp4',duration:6.679104},
                {id:'c',type:'image'}];

test('a shot longer than its source clip is rejected before it reaches the Skill',()=>{
 assert.throws(
  ()=>validate({clips:[{asset_id:'a',duration:6},{asset_id:'d',duration:7},{asset_id:'b',duration:7}]},measured,20),
  /第 3 个镜头「VID_220833\.mp4」从 0\.00 秒起要 7\.00 秒，但该素材只有 6\.68 秒/,
  '报错要写清第几个镜头、哪个素材、要多少、只有多少');
});

test('the source_start offset counts towards the clip window',()=>{
 // 从第 2 秒起再取 7 秒 = 用到第 9 秒，素材只有 6.68 秒 → 同样要拦
 assert.throws(
  ()=>validate({clips:[{asset_id:'a',duration:5},{asset_id:'d',duration:8},{asset_id:'b',source_start:2,duration:7}]},measured,20),
  /VID_220833\.mp4」从 2\.00 秒起要 7\.00 秒/);
});

test('images are never length-limited and the 1ms tolerance still holds',()=>{
 // 正好卡在素材长度上（含 1ms 容差）必须放行，不能把合法方案误杀
 const p=validate({clips:[{asset_id:'c',duration:13.321},{asset_id:'b',duration:6.679}]},measured,20);
 assert.equal(p.clips.length,2);
 assert.equal(p.clips[1].duration_us,6679000);
 // 图片没有 duration，给多长都行
 assert.equal(validate({clips:[{asset_id:'c',duration:20}]},measured,20).clips[0].duration_us,20e6);
});

test('assets without a measured duration are left alone (old callers keep working)',()=>{
 assert.equal(validate({clips:[{asset_id:'a',duration:20}]},assets,20).clips[0].duration_us,20e6);
});

/* 真实事故回归 2：模型写了 156 字口播，20 秒的片子根本放不下。
   本机执行器逐句合成配音、累加到超时才整条失败（且拒绝截断台词），
   所以必须在提交前就按语速估一遍。
   实测基准（Edge TTS 逐句合成 + 0.1 秒句间停顿）：156 非标点字 → 39.52 秒。 */
const EP=require('../edit-plan');
const LONG='秋冬想做显白款，先看琥珀晕染的配色逻辑。琥珀是暖棕底加金调晕开，冷灰放黄皮手上会发青，金棕反而把肤色往暖里带。甲型我给她留的短圆方，通勤打字不挂键盘，太长那种坐办公室真的不方便。配驼色大衣或者米白针织都行，金色戒指和琥珀是顺色的。想做的先把这篇收藏着，拿不准适不适合自己，站内私信发张手图，我帮你看看。店在静安虬江路，宝山路地铁站走过来五分钟。';

test('narration that cannot fit the target duration is rejected before TTS runs',()=>{
 assert.throws(
  ()=>validate({clips:[{asset_id:'a',duration:20}],narration:LONG},assets,20),
  /口播太长：现在 156 字 \/ 6 句[\s\S]*约需 39\.\d 秒，但整片只有 20 秒（上限约 \d+ 字）[\s\S]*不要把一句话拆成几个短句/,
  '报错要写清现在多少字几句、约需多少秒、上限多少字，并点明拆短句会浪费时间');
});

const SHORT1='秋冬显白，琥珀晕染是关键。';                                  // 11 字 / 1 句
const SHORT5='显白。琥珀。短圆方。顺色。收藏。';                              // 11 字 / 5 句
const MID2='秋冬想做显白款，先看琥珀晕染的配色逻辑。琥珀是暖棕底加金调晕开，冷灰放黄皮手上会发青。'; // 39 字 / 2 句
const MID4='秋冬显白，琥珀晕染是关键。琥珀是暖棕加金调晕开，冷灰放黄皮手上会发青，金棕反而把肤色往暖里带。甲型留短圆方，打字不挂键盘。配驼色大衣或米白针织都顺色。'; // 67 字 / 4 句
const LONG6='秋冬显白，琥珀晕染是关键。琥珀是暖棕加金调晕开。甲型留短圆方，打字不挂键盘。配驼色大衣或米白针织都顺色。旧毛衣别扔，配个金色戒指就活了。收藏这篇，下次做甲直接给美甲师看。'; // 75 字 / 6 句

test('the estimator matches the six measured samples',()=>{
 // 实测口径：逐句合成 + 执行器 0.1 秒句间停顿，zh-CN-XiaoxiaoNeural
 for(const [text,chars,sent,actual] of [[SHORT1,11,1,3.24],[MID2,39,2,10.28],[LONG,156,6,39.52],
                                        [SHORT5,11,5,7.12],[MID4,67,4,18.44],[LONG6,75,6,21.74]]){
  assert.equal(EP.narrationChars(text),chars,'字数');
  assert.equal(EP.narrationSentences(text),sent,'句数');
  assert.ok(Math.abs(EP.narrationSeconds(text)-actual)<=0.2,
   chars+' 字 / '+sent+' 句：估算 '+EP.narrationSeconds(text).toFixed(2)+' 实测 '+actual);
 }
});

test('sentence count matters as much as character count',()=>{
 // 同样 11 个字：1 句 3.2 秒，拆成 5 句要 7.1 秒 —— 口播写成短句罗列会白扔掉一半时长
 assert.equal(EP.narrationChars(SHORT1),EP.narrationChars(SHORT5));
 assert.ok(EP.narrationSeconds(SHORT5)-EP.narrationSeconds(SHORT1)>3,'每多一句要白占约 0.9 秒');
 // 旧公式（只用字/秒，3.9）会把这条 75 字 6 句估成 19.7 秒放过，实际要 21.7 秒，执行器必然失败
 assert.throws(
  ()=>validate({clips:[{asset_id:'a',duration:20}],narration:LONG6},assets,20),
  /口播太长：现在 75 字 \/ 6 句/,'短句多、总字数看着不超的方案同样要拦');
});

test('the budget shrinks with the target and scales with the sentence count',()=>{
 assert.equal(EP.narrationBudget(12),28);
 assert.equal(EP.narrationBudget(20),65);
 assert.equal(EP.narrationBudget(30),111);
 // 句数越多，能写的字越少
 assert.ok(EP.narrationBudget(20,8)<EP.narrationBudget(20,4));
 assert.ok(EP.narrationBudget(1)>=0,'极短目标不能算出负数');
});

test('narration at the budget passes and an empty narration is never blocked',()=>{
 // 正好写到上限字数必须放行，否则模型每轮都被误杀、三次重排后整条任务失败
 const at='字'.repeat(EP.narrationBudget(20));
 assert.equal(validate({clips:[{asset_id:'a',duration:20}],narration:at},assets,20).narration.length,65);
 // music / original 模式没有口播文案，不能被这条检查拦住
 assert.equal(validate({clips:[{asset_id:'a',duration:20}]},assets,20).narration,'');
});

test('visual items survive and运镜 expands into keyframes',()=>{
 const p=validate({clips:[
  {asset_id:'a',duration:10,motion:'push_in',filter:{name:'奶油',intensity:80},effect:'柔和辉光',transition:{name:'叠化',duration_ms:500}},
  {asset_id:'b',duration:10,motion:'none'}]},assets,20);
 assert.equal(p.version,2);
 assert.deepEqual(p.warnings,[]);
 assert.equal(p.clips[0].motion,'push_in');
 assert.deepEqual(p.clips[0].keyframes,[{property:'uniform_scale',at:0,value:1},{property:'uniform_scale',at:1,value:1.12}]);
 assert.deepEqual(p.clips[0].filter,{name:'奶油',intensity:80});
 assert.deepEqual(p.clips[0].effect,{name:'柔和辉光'});
 assert.deepEqual(p.clips[0].transition,{name:'叠化',duration_us:500000});
 assert.equal(p.clips[1].motion,null);
 assert.deepEqual(p.clips[1].keyframes,[]);
});

test('unknown visual names are dropped with warnings instead of failing the job',()=>{
 const p=validate({clips:[
  {asset_id:'a',duration:10,motion:'火箭推进',filter:'不存在的滤镜',effect:'爆炸',transition:'传送门'},
  {asset_id:'b',duration:10}]},assets,20);
 assert.equal(p.clips[0].motion,null);
 assert.equal(p.clips[0].filter,null);
 assert.equal(p.clips[0].effect,null);
 assert.equal(p.clips[0].transition,null);
 assert.equal(p.warnings.length,4);
 assert.match(p.warnings.join('|'),/运镜.*火箭推进/);
 assert.match(p.warnings.join('|'),/滤镜/);
});

test('transition is ignored on the last shot and clamped by neighbouring lengths',()=>{
 const p=validate({clips:[
  {asset_id:'a',duration:1.6,transition:{name:'叠化',duration_ms:900}},
  {asset_id:'b',duration:18.4,transition:{name:'闪黑'}}]},assets,20);
 // 相邻较短镜头 1.6s，转场上限取一半即 800ms
 assert.equal(p.clips[0].transition.duration_us,800000);
 assert.equal(p.clips[1].transition,null,'最后一个镜头后面没有转场');
});
test('zero-length shots cannot carry a transition',()=>{
 const p=validate({clips:[{asset_id:'a',duration:0.2,transition:'叠化'},{asset_id:'b',duration:19.8}]},assets,20);
 assert.equal(p.clips[0].transition,null);
 assert.match(p.warnings.join('|'),/镜头太短/);
});
test('effects are capped and highlights must appear in the caption text',()=>{
 const p=validate({clips:[
  {asset_id:'a',duration:7,effect:'柔和辉光'},
  {asset_id:'b',duration:7,effect:'贴身粒子'},
  {asset_id:'a',duration:6,effect:'飘雪'}],
  captions:[{start:0,end:3,text:'显白只要 99 元',anim:'随机打字机',highlight:['99 元','没有的词']}]},assets,20);
 assert.equal(p.clips.filter(c=>c.effect).length,C.MAX_EFFECTS);
 assert.equal(p.clips[2].effect,null);
 assert.match(p.warnings.join('|'),/画面特效最多/);
 assert.deepEqual(p.captions[0].highlight,[{word:'99 元'}]);
 assert.equal(p.captions[0].anim,'随机打字机');
 assert.match(p.warnings.join('|'),/高亮词/);
});
test('catalog names are unique and the prompt lists all four categories',()=>{
 for(const list of [C.TRANSITIONS,C.FILTERS,C.EFFECTS,C.TEXT_ANIMS]){
  assert.ok(list.length>=10);
  assert.equal(new Set(list.map(i=>i.name)).size,list.length,'名字必须唯一');
  for(const item of list){assert.ok(item.name&&item.when,'每项都要有名字和适用场景');}
 }
 assert.deepEqual(C.expandMotion('none'),[]);
 assert.ok(C.expandMotion('pan_left').some(k=>k.property==='position_x'));
 const text=C.promptText();
 for(const n of ['叠化',...C.FILTERS.slice(0,1).map(i=>i.name),...C.EFFECTS.slice(0,1).map(i=>i.name),'随机打字机','push_in'])assert.ok(text.includes(n),'提示词应列出 '+n);
});

/* 名库只有真的进到 system prompt 才算接入。这里把 app.js 里那一段切出来，
   在隔离环境里跑一遍（喂假 llmStream 截获提示词），避免只看源码猜。 */
test('the edit planner prompt actually carries the catalog and the new schema',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
 const start=src.indexOf('function jyCatalogText()');
 assert.ok(start>0,'app.js 里应能找到 jyCatalogText');
 const slice=src.slice(start,src.indexOf('\n};',start)+3);
 let captured='';
 const window={JyCatalog:C};
 const ctx={window,llmStream:async msgs=>{captured=msgs[0].content;return '{"summary":"x","clips":[]}';}};
 vm.createContext(ctx);vm.runInContext(slice,ctx);
 const plan=await window.WorkbenchEditPlanner({title:'t'},null);
 assert.equal(plan.summary,'x');
 for(const n of ['【可用素材名','叠化','清透感','柔和辉光','随机打字机','push_in','"transition"','"highlight"','"intensity"'])
  assert.ok(captured.includes(n),'system prompt 里应包含 '+n);
 // 清单没加载时不能把整条链路带崩
 const bare={window:{},llmStream:async msgs=>{captured=msgs[0].content;return '{"summary":"y","clips":[]}';}};
 vm.createContext(bare);vm.runInContext(slice,bare);
 assert.equal((await bare.window.WorkbenchEditPlanner({},null)).summary,'y');
 assert.ok(!captured.includes('【可用素材名'));
 /* 口播字数上限必须真的进 system prompt：以前只写「每秒3-4个汉字」，
    模型并不知道自己只有 20 秒预算，于是照抄脚本、写出一倍字数。
    上限由 EditPlan 统一算，这里顺带锁住「提示词与校验层用同一个数」。 */
 const withBudget={window:{JyCatalog:C,EditPlan:EP},llmStream:async msgs=>{captured=msgs[0].content;return '{"summary":"b","clips":[]}';}};
 vm.createContext(withBudget);vm.runInContext(slice,withBudget);
 await withBudget.window.WorkbenchEditPlanner({voice:'tts',target_duration:20},null);
 assert.match(captured,/【口播字数硬约束】/,'TTS 模式必须给出字数上限');
 assert.match(captured,/整片只有 20 秒/);
 assert.ok(captured.includes('最多约 '+EP.narrationBudget(20)+' 字'),'上限要和校验层同源');
 assert.match(captured,/每个句子还要额外占约 0\.93 秒/,'要交代「拆短句会白扔时间」，这是实测结论');
 assert.match(captured,/不要把一句话拆成几个短句/);
 // 原声识别模式没有口播文案，不加这条约束
 const noBudget={window:{JyCatalog:C,EditPlan:EP},llmStream:async msgs=>{captured=msgs[0].content;return '{"summary":"c","clips":[]}';}};
 vm.createContext(noBudget);vm.runInContext(slice,noBudget);
 await noBudget.window.WorkbenchEditPlanner({voice:'original',target_duration:20},null);
 assert.ok(!captured.includes('【口播字数硬约束】'),'非 TTS 模式不该有口播字数上限');
 // 重排：上一版方案与失败原因必须真的回喂给模型，否则自愈是假的
 let retry=null;
 const again={window:{JyCatalog:C},llmStream:async msgs=>{retry=msgs;return '{"summary":"z","clips":[]}';}};
 vm.createContext(again);vm.runInContext(slice,again);
 await again.window.WorkbenchEditPlanner({title:'t'},null,{previous:'{"clips":[]}',error:'第 2 个镜头「VID_220833.mp4」超出素材长度'});
 assert.equal(retry.length,4,'system + user + 上一版方案 + 失败原因');
 assert.equal(retry[2].role,'assistant');
 assert.equal(retry[2].content,'{"clips":[]}');
 assert.match(retry[3].content,/超出素材长度/);
 assert.match(retry[3].content,/口播过长/,'重排提示要覆盖「口播过长」这条原因，不能只说素材时长');
 assert.match(retry[0].content,/source_start \+ duration 必须 ≤/,'时长硬约束要写进提示词');
 assert.ok(retry[0].content.includes('【可用素材名'),'重排时名库不能丢');
});

