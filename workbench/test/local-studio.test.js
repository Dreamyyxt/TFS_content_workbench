const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.VIDEO_LOCAL='1';
process.env.VIDEO_USER_TOKEN='test-local-secret';
const {server}=require('../server');
test('local pairing rejects other origins, hostnames and ordinary browser requests',async t=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  let r=await fetch(base+'/api/video/local-session');assert.equal(r.status,403);
  r=await fetch(base+'/api/video/local-session',{headers:{'X-Local-Studio':'1',Origin:'https://evil.invalid'}});assert.equal(r.status,403);
  const hostStatus=await new Promise((resolve,reject)=>{const req=require('node:http').get(base+'/api/video/local-session',{headers:{'X-Local-Studio':'1',Host:'evil.invalid'}},r=>{r.resume();resolve(r.statusCode);});req.on('error',reject);});assert.equal(hostStatus,403);
  r=await fetch(base+'/api/video/local-session',{headers:{'X-Local-Studio':'1'}});assert.equal(r.status,200);assert.equal((await r.json()).token,'test-local-secret');
  r=await fetch(base+'/.cloud/database/rest/scripts',{headers:{Origin:'https://evil.invalid'}});assert.equal(r.status,403);
});
