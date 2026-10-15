const test=require('node:test');
const assert=require('node:assert/strict');
const flow=require('../production-workflow.js');
test('production grouping distinguishes drafts, finished media and unresolved submissions',()=>{
 for(const status of ['queued','building','submitting','generating','downloading'])assert.equal(flow.group({status}),'active');
 assert.equal(flow.group({status:'draft_ready'}),'draft');assert.equal(flow.group({status:'finished'}),'finished');
 for(const status of ['failed','submission_unknown','new-status'])assert.equal(flow.group({status}),'attention');
 assert.match(flow.nextStep({status:'draft_ready'}),/导出 MP4/);
 assert.match(flow.nextStep({status:'submission_unknown'}),/核对任务 ID/);
 assert.match(flow.nextStep({status:'failed',mode:'generate',remote_id:'remote'}),/继续查询/);
 assert.match(flow.nextStep({status:'failed',mode:'generate',remote_id:'remote',remote_failed:true}),/是否重试/);
});
test('task search composes real status with title, account and production mode',()=>{
 const job={title:'琥珀甲片',account:'旧账号',mode:'edit',status:'draft_ready'};
 assert.equal(flow.matches(job,{status:'draft',query:' 琥珀 '}),true);
 assert.equal(flow.matches(job,{status:'active',query:'琥珀'}),false);
 assert.equal(flow.matches(job,{query:'剪映'}),true);assert.equal(flow.matches(job,{query:'旧账号'}),true);
 assert.equal(flow.matches(job,{query:'AI 生成'}),false);
});
test('preparation reflects mode, narration, uploaded music, incompatible media and connection',()=>{
 const input={title:'作品',script:'',assets:[{type:'image'}],connected:true,editReady:true};
 assert.deepEqual(flow.preparation(input).map(s=>s.ready),[false,true,true]);
 assert.deepEqual(flow.preparation({...input,narration:'口播'}).map(s=>s.ready),[true,true,true]);
 assert.equal(flow.preparation({...input,voice:'music',music:'upload'})[1].ready,false);
 assert.equal(flow.preparation({...input,voice:'music',music:'upload',hasMusic:true})[1].ready,true);
 const gen={mode:'generate',title:'作品',script:'镜头描述',connected:true,generationReady:true};
 assert.deepEqual(flow.preparation(gen).map(s=>s.ready),[true,true,true]);
 assert.equal(flow.preparation({...gen,assets:[{type:'video'}]})[1].ready,false);
 assert.equal(flow.preparation({...gen,connected:false})[2].ready,false);
 assert.equal(flow.preparation({...gen,title:' '})[0].ready,false);
 assert.equal(flow.preparation({...gen,assets:Array(10).fill({type:'image'})})[1].ready,false);
});
