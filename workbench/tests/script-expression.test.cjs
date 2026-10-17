const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../script-expression'),S=require('../shooting-plan');
const account={name:'演示号',shots:'3–5',duration:'10-15s'};
const draft=`## 一句话脚本定位
用现有作品演示手部角度。
## 开场设计
直接给出手部侧面，先让观众看到轮廓再转向正面。
## 分镜表
| 时间 | 画面 / 运镜 | 口播 | 字幕 / 贴纸 |
| --- | --- | --- | --- |
| 0–3秒 | 拍摄手部侧面 | — | 先看侧面 |
| 3–8秒 | 缓慢转向正面 | 把手转过来，看这个角度。 | 正面 |
| 8–12秒 | 保持完整上手画面 | — | 完整效果 |
## 发布配置
- 发布标题：同一只手，换个角度
## 合规提示
拍摄前确认款式；不虚构客户经历。`;
const edit=()=>({opening:'先停在侧面，转向正面时让轮廓变化成为开场看点。',shots:[{index:1,voice:'—',caption:'侧面'},{index:2,voice:'转过来看看。',caption:'正面'},{index:3,voice:'—',caption:'完整上手'}]});
test('Humanizer edits expressions without modifying scenes, timeline or publication notes',()=>{
 const before=E.validate(draft,account),after=E.applyReview(draft,edit()),p=E.validate(after,account);
 assert.deepEqual(p.shots.map(s=>[s.time,s.scene]),before.shots.map(s=>[s.time,s.scene]));
 assert.ok(after.endsWith(draft.split('## 发布配置')[1]));assert.equal(S.parse(after).mode,'shots');
 assert.equal(p.opening,edit().opening);assert.equal(p.shots[1].voice,'转过来看看。');
 assert.deepEqual(E.issues(after,[],account.name),[]);
 const pipes=edit();pipes.shots[1].caption='侧面 | 正面';assert.equal(E.parse(E.applyReview(draft,pipes)).shots[1].caption,'侧面 | 正面');
});
test('malformed or mismatched review never becomes a saved script',()=>{
 for(const bad of [null,{}, {...edit(),shots:edit().shots.slice(1)}, {...edit(),shots:[edit().shots[0],edit().shots[0],edit().shots[2]]}, {...edit(),opening:'<script>x</script>'}])assert.throws(()=>E.applyReview(draft,bad));
 const injected=edit();injected.shots[0].caption='标题\n## 替换章节';assert.throws(()=>E.applyReview(draft,injected));
 const changed=edit();changed.shots[0].voice='突然新增整段口播';assert.throws(()=>E.applyReview(draft,changed),/新增/);
});
test('invalid table, gaps, wrong shot count and duration are rejected',()=>{
 for(const bad of [draft.replace('3–8秒','4–8秒'),draft.replace('8–12秒','8–30秒'),draft.replace('3–8秒','3–3秒'),draft.replace('正面 |','正面 | 多一列 |'),draft.replace('## 开场设计','## 旧标题')])assert.throws(()=>E.validate(bad,account));
 assert.throws(()=>E.validate(draft,{...account,shots:'4–6'}));
 assert.doesNotThrow(()=>E.validate(draft.replace('0–3秒','0:00–0:03'),account));
});
test('recent expressions include legacy table scripts, are account scoped and bounded',()=>{
 const older=draft.replace('## 开场设计','## 黄金 3 秒钩子（原句，可直接念）');
 const history=Array.from({length:20},(_,i)=>({account:i===0?'其他号':account.name,title:'旧稿'+i,content:older}));
 const recent=E.recent(history,account.name);assert.equal(recent.length,12);assert.equal(recent[0].title,'旧稿1');assert.match(recent[0].voice,/转过来/);assert.match(recent[0].opening,/轮廓/);
 assert.match(E.direction({account:account.name,title:'角度'},'已确认的实拍细节',history),/已确认的实拍细节/);
 assert.match(E.direction({account:account.name},'',history),/当前没有观看实拍素材/);
});
test('repetition checks catch punctuation edits and copied voice while allowing silence and short terms',()=>{
 assert.equal(E.similar('把手转过来，看这个角度。','把手转过来！看这个角度'),true);
 assert.equal(E.similar('—','—'),false);assert.equal(E.similar('甲型','甲型'),false);
 const history=[{account:account.name,title:'旧稿',content:draft}];
 assert.match(E.issues(draft,history,account.name).join('；'),/开场设计.*相近/);
 assert.match(E.issues(draft,history,account.name).join('；'),/整句/);
 assert.deepEqual(E.issues(draft,history,'另一个账号'),[]);
 assert.match(E.issues(draft.replace('把手转过来，看这个角度。','值得一提的是，这个角度可以看轮廓。'),[],account.name).join('；'),/套话/);
 assert.match(E.issues(draft.replace('把手转过来，看这个角度。','这一段口播太长'.repeat(20)),[],account.name).join('；'),/口播过长/);
});
test('same-account jobs wait for prior completion; another account is independent; release survives failure',async()=>{
 const reserve=E.createQueue(),first=reserve('a'),second=reserve('a'),other=reserve('b');let ran=false;
 second.wait.then(()=>ran=true);await other.wait;assert.equal(ran,false);other.release();
 first.release();await second.wait;assert.equal(ran,true);second.release();await reserve('a').wait;
});
