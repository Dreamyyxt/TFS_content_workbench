const {test}=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createJianyingAPI}=require('../jianying-api');const {createVolcClient,DEFAULT_MODEL}=require('../volc-video');
async function setup(volc){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jy-gen-'));const api=createJianyingAPI({dir,userToken:'user',workerToken:'worker',local:true,volc,generationInterval:10});const server=http.createServer((req,res)=>api(req,res,new URL(req.url,'http://localhost')));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/jianying/';
const request=(route,body)=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer user','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
return {dir,base,request,async close(){api.close();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}};}
async function wait(fn){for(let n=0;n<100;n++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,10));}throw Error('condition timed out');}
const params={mode:'generate',script:'微距作品展示',title:'生成测试',asset_ids:[],duration:5,request_id:'generation',model:DEFAULT_MODEL};
test('script-only generation, role isolation, durable completion and MP4 range',async()=>{let submissions=0;const s=await setup({async submit(job){submissions++;assert.equal(job.assets.length,0);return 'cgt-test';},async get(){return {status:'succeeded',content:{video_url:'https://result.volces.com/movie.mp4'}};},async download(url,destination){fs.writeFileSync(destination,Buffer.from('0000ftyp000000000000'));}});
try{
assert.equal((await s.request('jobs',{...params,mode:'edit',duration:20})).status,400);
assert.equal((await s.request('jobs',{...params,script:''})).status,400);
assert.equal((await s.request('jobs',{...params,duration:20})).status,400);
const job=await(await s.request('jobs',params)).json();assert.ok(job.id);
await wait(async()=>{const jobs=await(await s.request('jobs')).json();return jobs[0].status==='finished';});
assert.equal((await(await s.request('jobs',params)).json()).id,job.id);assert.equal(submissions,1);
const range=await fetch(s.base+'jobs/'+job.id+'/final',{headers:{Authorization:'Bearer user',Range:'bytes=4-7'}});assert.equal(range.status,206);assert.equal(await range.text(),'ftyp');
const saved=JSON.parse(fs.readFileSync(path.join(s.dir,'state.json'))).jobs[0];assert.equal(saved.remote_id,'cgt-test');assert.match(saved.submitted_prompt,/微距作品展示/);assert.ok(saved.last_checked_at);assert.ok(saved.query_count>0);
}finally{await s.close();}});
test('uncertain POST is never automatically retried; reconciliation resumes existing task',async()=>{let attempts=0;const s=await setup({async submit(){attempts++;throw Object.assign(Error('unknown'),{uncertain:true});},async get(){return {status:'failed',error:{message:'provider failed'}};}});
try{const job=await(await s.request('jobs',params)).json();await wait(async()=>{const j=(await(await s.request('jobs')).json())[0];return j.status==='submission_unknown';});await new Promise(r=>setTimeout(r,40));assert.equal(attempts,1);assert.equal((await s.request('jobs/'+job.id+'/retry',{})).status,409);assert.equal((await s.request('jobs/'+job.id+'/reconcile',{remote_id:'cgt-existing'})).status,200);await wait(async()=>{const j=(await(await s.request('jobs')).json())[0];return j.status==='failed' && j.remote_id==='cgt-existing';});assert.equal(attempts,1);}finally{await s.close();}});
test('Volc request includes script and selected params; key stays out of errors',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'volc-key-'));const keyFile=path.join(dir,'key');fs.writeFileSync(keyFile,'secret-for-test');let payload;
try{const client=createVolcClient({keyFile,fetchImpl:async(url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({id:'cgt-1'}),{status:200});}});assert.equal(await client.submit({...params,assets:[],instructions:'自然光'},dir),'cgt-1');assert.equal(payload.duration,5);assert.equal(payload.ratio,'9:16');assert.match(payload.content[0].text,/微距作品展示/);
const bad=createVolcClient({keyFile,fetchImpl:async()=>new Response(JSON.stringify({error:{message:'secret-for-test rejected'}}),{status:401})});const state=await bad.capabilities();assert.equal(state.ready,false);assert.ok(!state.error.includes('secret-for-test'));
}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('page-pasted Volc key wins over the local key file and never leaks',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'volc-page-'));const keyFile=path.join(dir,'volc.key');const seen=[];
const mk=(opts={})=>createVolcClient({keyFile,fetchImpl:async(url,options)=>{seen.push(options.headers.Authorization);return new Response(JSON.stringify({data:[]}),{status:200});},...opts});
try{
/* 1) 页面没配、本机也没文件 → 提示去页面粘贴，而不是让人去翻 key 文件 */
const none=mk();assert.equal(none.keySource(),'none');assert.equal(none.hasKey(),false);
const st=await none.capabilities();assert.equal(st.ready,false);assert.match(st.error,/🔑 密钥/);
/* 2) 只有本机 key 文件 → 沿用老用法 */
fs.writeFileSync(keyFile,'file-key');const fromFile=mk();assert.equal(fromFile.keySource(),'file');
assert.equal((await fromFile.capabilities()).source,'file');assert.equal(seen.at(-1),'Bearer file-key');
/* 3) 页面粘贴后优先用页面的（不落盘） */
fromFile.setKey('page-key-1234567890');assert.equal(fromFile.keySource(),'page');
const st3=await fromFile.capabilities();assert.equal(st3.ready,true);assert.equal(st3.source,'page');assert.equal(seen.at(-1),'Bearer page-key-1234567890');
/* 4) 清空页面密钥 → 回落到本机 key 文件 */
fromFile.setKey('');assert.equal(fromFile.keySource(),'file');
/* 5) 页面来源的密钥同样不进错误信息 */
const st5=await createVolcClient({keyFile,fetchImpl:async()=>new Response(JSON.stringify({error:{message:'page-key-1234567890 rejected'}}),{status:401}),runtimeKey:'page-key-1234567890'}).capabilities();
assert.equal(st5.ready,false);assert.equal(st5.source,'page');assert.ok(!st5.error.includes('page-key-1234567890'));
}finally{fs.rmSync(dir,{recursive:true,force:true});}});
