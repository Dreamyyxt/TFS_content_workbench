const test=require('node:test'),assert=require('node:assert/strict');
const H=require('../humanizer-policy');

test('rules() 按账号切换语气，且都带上红线约束',()=>{
 const boss=H.rules('老板IP号'),off=H.rules('抖音官方号');
 assert.notEqual(boss,off);
 assert.match(boss,/口头禅|跑题/);
 assert.match(off,/干净克制/);
 for(const r of [boss,off]){
  assert.match(r,/不新增事实/);
  assert.match(r,/不改分镜表结构/);
  assert.match(r,/否定对举/);
 }
});

test('rules(account,scope) 的 plan 版面向标题与钩子',()=>{
 assert.match(H.rules('','plan'),/标题 \/ 钩子/);
 assert.match(H.rules('老板IP号'),/口播 \/ 字幕/);
});

test('voiceOf 对未知账号回落到默认语气',()=>{
 assert.match(H.voiceOf('不存在的号'),/真人对着手机/);
 assert.equal(H.voiceOf('店铺日常号'),H.VOICE.daily);
 assert.equal(H.voiceOf('daily'),H.VOICE.daily);
});

test('scan 抓出典型 AI 腔，干净口播不误报',()=>{
 const bad=H.scan('姐妹们，这不仅仅是一次美甲，更是一种生活态度。值得一提的是，我们采用——极致工艺。');
 const groups=bad.hard.map(h=>h.group);
 assert.ok(groups.includes('否定对举'));
 assert.ok(groups.includes('空话套话'));
 assert.ok(bad.layout.some(h=>h.group==='破折号'));
 assert.equal(bad.soft.some(h=>h.group==='万能赞美'),true);
 const good=H.scan('今天下午三点，客人拿来一张参考图，是带一点灰调的奶茶色。我给她试了两个色，最后选了浅的那个。');
 assert.equal(good.hard.length,0);
 assert.equal(good.soft.length,0);
});

test('排版特征单独归类，不计入需要改写的条数',()=>{
 const r=H.scan('| **时间** | 画面 |\n|---|---|\n| 0-2s | 特写 |');
 assert.ok(r.layout.length>0);
 assert.equal(H.countFor(r),0);
 assert.equal(H.briefText(r),'');
 assert.match(H.briefText(r,true),/加粗当装饰/);
});

test('countFor 只统计 AI 腔与广告腔，briefText 汇总分组',()=>{
 const r=H.scan('只为让你遇见更美的自己，极致。');
 assert.equal(H.countFor(r),3);
 assert.match(H.briefText(r),/广告腔×\d/);
 assert.match(H.briefText(r),/万能赞美×1/);
 assert.equal(H.scan('').count,0);
});
