const {test}=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createJianyingAPI}=require('../jianying-api');
test('origin/auth, idempotency, worker claim, lease fencing and retry',async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jy-api-'));const api=createJianyingAPI({dir,userToken:'user',workerToken:'worker',local:true,leaseMs:30});
const server=http.createServer((req,res)=>api(req,res,new URL(req.url,'http://localhost')));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/jianying/';
async function request(route,body,token='user',extra={}){return fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)});}
try{
assert.equal((await request('jobs',undefined,'bad')).status,401);
assert.equal((await request('session',undefined,'user',{Origin:'https://evil.example','X-Jianying-Studio':'1'})).status,403);
assert.equal((await request('session',undefined,'user',{'X-Jianying-Studio':'1'})).status,200);
const asset=await (await fetch(base+'assets?name=photo.png',{method:'POST',headers:{Authorization:'Bearer user'},body:Buffer.from('test')})).json();
const body={asset_ids:[asset.id],duration:20,request_id:'same'};
const job=await (await request('jobs',body)).json();assert.equal((await (await request('jobs',body)).json()).id,job.id);
assert.equal((await request('worker/claim',{ready:true},'user')).status,401);
const claim=await (await request('worker/claim',{ready:true},'worker')).json();
assert.equal((await request('worker/jobs/'+job.id+'/complete',{draft_path:'/tmp/draft',clips:[{}]},'worker',{'X-Job-Claim':'wrong'})).status,409);
await new Promise(r=>setTimeout(r,45));
assert.equal((await request('worker/jobs/'+job.id+'/complete',{draft_path:'/tmp/draft',clips:[{}]},'worker',{'X-Job-Claim':claim.claim})).status,409);
assert.equal((await request('jobs/'+job.id+'/retry',{})).status,200);
assert.equal((await (await request('jobs')).json())[0].status,'queued');
}finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('planned edits preserve music, repeated shots, stages and execution report',async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jy-plan-'));const api=createJianyingAPI({dir,userToken:'user',workerToken:'worker',local:true});const server=http.createServer((req,res)=>api(req,res,new URL(req.url,'http://localhost')));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/jianying/';
const post=(route,body,token='user',extra={})=>fetch(base+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
try{const upload=async name=>(await fetch(base+'assets?name='+name,{method:'POST',headers:{Authorization:'Bearer user'},body:Buffer.from('fixture')})).json();const image=await upload('photo.png'),music=await upload('music.mp3');
const body={asset_ids:[image.id],duration:20,request_id:'planned',edit_options:{voice:'tts',speaker:'zh_female_xiaopengyou',music:'upload',music_asset_id:music.id,music_volume:0.2},edit_plan:{clips:[{asset_id:image.id,source_start_us:0,duration_us:10000000},{asset_id:image.id,source_start_us:0,duration_us:10000000}],captions:[],narration:'测试口播'}};
assert.equal((await post('jobs',{...body,edit_plan:{...body.edit_plan,clips:[]}})).status,400);const response=await post('jobs',body);assert.equal(response.status,201);const job=await response.json();const claim=await(await post('worker/claim',{ready:true},'worker')).json();assert.equal(claim.music_asset.id,music.id);assert.equal(claim.edit_plan.clips[1].start_us,10000000);
const fence={'X-Job-Claim':claim.claim};assert.equal((await post('worker/jobs/'+job.id+'/heartbeat',{stage:'生成口播'},'worker',fence)).status,200);assert.equal((await post('worker/jobs/'+job.id+'/complete',{draft_path:'/tmp/planned',clips:[{},{}],edit_report:{subtitles:1,music:'uploaded'}},'worker',fence)).status,200);
const saved=JSON.parse(fs.readFileSync(path.join(dir,'state.json'))).jobs[0];assert.equal(saved.edit_report.subtitles,1);assert.equal(saved.status,'draft_ready');
}finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
