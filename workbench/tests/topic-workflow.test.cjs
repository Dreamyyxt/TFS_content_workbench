const {test}=require('node:test'),assert=require('node:assert/strict');
const T=require('../topic-workflow'),A=require('../account-strategy');
const accounts=[{...A.defaults[0],planCount:1},{...A.defaults[1],enabled:false}];
const row={account:accounts[0].name,title:'enoi 的透色上手',angle:'拍摄色胶透度',hook:'靠近看这层透色',trend_reason:'常青选题，未取得近期来源',keywords:['enoi'],content_form:'作品展示'};
test('drafts require active accounts, complete writing, distinct titles and configured counts',()=>{
 const out=T.validate([row],accounts);assert.equal(out[0].platform,'抖音');assert.equal(out[0].goal,accounts[0].goal);
 assert.throws(()=>T.validate([{...row,account:accounts[1].name}],accounts),/未启用/);
 assert.throws(()=>T.validate([{...row,hook:''}],accounts),/不完整/);
 assert.throws(()=>T.validate([row,row],accounts),/重复/);
 assert.throws(()=>T.validate([row],[{...accounts[0],planCount:2}]),/应生成 2 条/);
});
test('Humanizer only edits prose, preserving the account, keywords, identity and order',()=>{
 const draft=T.validate([row],accounts);
 const edited=T.applyReview(draft,[{...draft[0],title:'enoi 透色，近一点看',account:'被篡改',keywords:['假的'],platform:'被篡改'}]);
 assert.equal(edited[0].account,row.account);assert.deepEqual(edited[0].keywords,['enoi']);assert.equal(edited[0].platform,'抖音');assert.equal(edited[0].title,'enoi 透色，近一点看');
 assert.throws(()=>T.applyReview(draft,[]),/不完整/);
 assert.throws(()=>T.applyReview(draft,[{...draft[0],id:'wrong'}]),/标识/);
 assert.throws(()=>T.applyReview(draft,[{...draft[0],hook:'值得一提的是，透色'}]),/套话/);
 const prompt=T.reviewPrompt(draft,accounts,'2026年近期来源');assert.match(prompt,/先找出套话/);assert.match(prompt,/不新增价格/);assert.ok(prompt.includes(accounts[0].speech));assert.match(prompt,/2026年近期来源/);
});
