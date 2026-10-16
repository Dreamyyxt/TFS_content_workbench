const {test}=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createAccessPolicy,parseHosts}=require('../access-policy');
const {createJianyingAPI}=require('../jianying-api');
const WEB_ORIGIN='https://nail-content-workbench.app.workbuddy.host';

test('可信来源判定：本机回环 + 显式授权域名，其余网页一律拒绝',()=>{
const p=createAccessPolicy('nail.example.ts.net, 124-0-0-1.foo.ts.net');
assert.deepEqual(parseHosts(' a.com ,,B.com '),['a.com','b.com']);
assert.deepEqual(createAccessPolicy(undefined).extra,[]);
assert.deepEqual(createAccessPolicy([' A.com ']).extra,['a.com']);
assert.equal(p.trustedHost('127.0.0.1'),true);
assert.equal(p.trustedHost('localhost'),true);
assert.equal(p.trustedHost('NAIL.EXAMPLE.ts.net'),true);
assert.equal(p.trustedHost('evil.example'),false);
assert.equal(p.trustedHost(''),true);
/* 同源页面：本机 / 局域网 / 远程域名都算可信 */
assert.equal(p.knownOrigin('http://127.0.0.1:4191','127.0.0.1'),true);
assert.equal(p.knownOrigin('http://192.168.0.76:4191','192.168.0.76'),true);
assert.equal(p.knownOrigin('https://nail.example.ts.net','nail.example.ts.net'),true);
/* 反代改写了 Host 时靠白名单兜底 */
assert.equal(p.knownOrigin('https://nail.example.ts.net','127.0.0.1'),true);
/* 线上工作台照旧 */
assert.equal(p.knownOrigin(WEB_ORIGIN,'127.0.0.1',WEB_ORIGIN),true);
/* 无 Origin（worker / curl）不拦；跨站网页一律拦 */
assert.equal(p.knownOrigin(undefined,'127.0.0.1'),true);
assert.equal(p.knownOrigin('https://evil.example','127.0.0.1'),false);
assert.equal(p.knownOrigin('https://evil.example','nail.example.ts.net'),false);
assert.equal(p.knownOrigin('not a url','127.0.0.1'),false);
});

function request(port,route,{method='GET',headers={},body}={}){
return new Promise((resolve,reject)=>{
const r=http.request({host:'127.0.0.1',port,path:'/api/jianying/'+route,method,headers},res=>{
let data='';res.on('data',c=>data+=c);res.on('end',()=>{let json=null;try{json=JSON.parse(data);}catch(e){}resolve({status:res.statusCode,json});});
});
r.on('error',reject);if(body!==undefined)r.write(JSON.stringify(body));r.end();
});
}

test('远程（已授权域名）能连本机服务；未授权域名被拒；线上网页不受影响',async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jy-remote-'));
const api=createJianyingAPI({dir,userToken:'user',workerToken:'worker',local:true,trustedHosts:['nail.example.ts.net']});
const server=http.createServer((req,res)=>api(req,res,new URL(req.url,'http://localhost')));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port, studio={'X-Jianying-Studio':'1'};
try{
/* 反代保留 Host：Host 是远程域名 */
const a=await request(port,'session',{headers:{Host:'nail.example.ts.net',Origin:'https://nail.example.ts.net',...studio}});
assert.equal(a.status,200);assert.equal(a.json.token,'user');
/* 反代改写 Host 为回环：靠授权名单兜底 */
const b=await request(port,'session',{headers:{Host:'127.0.0.1:4191',Origin:'https://nail.example.ts.net',...studio}});
assert.equal(b.status,200);
/* 拿 token 后调接口：https 域名的 Origin 也要放行 */
assert.equal((await request(port,'status',{headers:{Host:'nail.example.ts.net',Origin:'https://nail.example.ts.net',Authorization:'Bearer user'}})).status,200);
/* 未授权域名：领不到 token */
assert.equal((await request(port,'session',{headers:{Host:'evil.example',Origin:'https://evil.example',...studio}})).status,403);
/* 别的网页想调本机服务（Origin 不可信）→ 403；反代保留或改写 Host 都拦得住 */
assert.equal((await request(port,'status',{headers:{Host:'127.0.0.1:'+port,Origin:'https://evil.example',Authorization:'Bearer user'}})).status,403);
assert.equal((await request(port,'status',{headers:{Host:'nail.example.ts.net',Origin:'https://evil.example',Authorization:'Bearer user'}})).status,403);
/* 同源页面（局域网里直接开工作台）不受影响 */
assert.equal((await request(port,'status',{headers:{Host:'192.168.0.76:4191',Origin:'http://192.168.0.76:4191',Authorization:'Bearer user'}})).status,200);
/* 已发布的线上工作台照旧可用 */
assert.equal((await request(port,'status',{headers:{Authorization:'Bearer user',Origin:WEB_ORIGIN}})).status,200);
assert.equal((await request(port,'session',{headers:{...studio,Origin:WEB_ORIGIN}})).status,200);
/* 本机（无 Origin）照旧可用 */
assert.equal((await request(port,'status',{headers:{Authorization:'Bearer user'}})).status,200);
}finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
