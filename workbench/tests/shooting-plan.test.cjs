const test=require('node:test');
const assert=require('node:assert/strict');
const {parse,restore}=require('../shooting-plan.js');

test('generated storyboard keeps all original columns and excludes publishing metadata',()=>{
 const plan=parse('## 分镜表\n| 时间 | 画面 / 运镜 | 口播 | 字幕 / 贴纸 | 道具 |\n|---|---|---|---|---|\n|0–3秒|指尖特写|今天的颜色|琥珀|咖啡杯|\n|3–8秒|转动手指||细节|—|\n\n## 发布配置\n|配置|内容|\n|---|---|\n|标题|上手效果|');
 assert.equal(plan.mode,'shots');assert.equal(plan.steps.length,2);
 assert.equal(plan.steps[0].time,'0–3秒');assert.equal(plan.steps[0].fields[4].text,'咖啡杯');
 assert.equal(plan.steps[1].fields[2].text,'');
 assert.ok(!JSON.stringify(plan).includes('上手效果'));
});
test('escaped pipes, inline code and line breaks do not corrupt shot boundaries',()=>{
 const plan=parse('时间 | 画面 | 旁白\n:--- | ---: | ---\n0-3s | A\\|B<br>转场 | `甲|乙`');
 assert.equal(plan.mode,'shots');assert.equal(plan.steps[0].fields[1].text,'A|B\n转场');
 assert.equal(plan.steps[0].fields[2].text,'甲|乙');
});
test('malformed rows fall back to the complete source instead of silently dropping instructions',()=>{
 const source='## 分镜表\n|时间|画面|\n|---|---|\n|0–3秒|特写|\n|3–8秒|侧面|额外列|\n\n## 发布配置\n原文备注';
 const plan=parse(source);assert.equal(plan.mode,'text');
 const text=plan.steps.map(s=>s.fields[0].text).join('\n');
 assert.match(text,/额外列/);assert.match(text,/原文备注/);assert.match(text,/0–3秒/);
});
test('empty, plain text, timed paragraphs and fenced examples remain readable without inventing shots',()=>{
 assert.deepEqual(parse(' \n '),{mode:'empty',steps:[]});
 const plan=parse('开场说明\n\n0–3秒：展示指尖\n3–12秒：转动角度\n\n## 拍摄提醒\n不要背光');
 assert.equal(plan.mode,'text');assert.equal(plan.steps.length,4);
 assert.match(plan.steps[3].fields[0].text,/不要背光/);
 const fenced=parse('```md\n|时间|画面|\n|---|---|\n|0–3秒|示例|\n```');
 assert.equal(fenced.mode,'text');assert.match(fenced.steps[0].fields[0].text,/示例/);
});
test('script revisions reset checklist progress; restored state validates positions, marks and size',()=>{
 const old={version:1,source:'same',index:50,done:[0,0,-1,1.2,2,99,'1'],size:'extra'};
 assert.deepEqual(restore('same',3,old).state,{version:1,source:'same',index:2,done:[0,2],size:'extra'});
 const changed=restore('new',3,old);assert.equal(changed.changed,true);
 assert.deepEqual(changed.state.done,[]);assert.equal(changed.state.index,0);
 assert.equal(restore('same',0,old).state.index,0);
 assert.equal(restore('same',3,{...old,index:NaN,done:'bad',size:'invalid'}).state.size,'large');
 assert.deepEqual(restore('same',3,{version:999}).state.done,[]);
 assert.equal(restore('same',3,null).changed,false);
});
