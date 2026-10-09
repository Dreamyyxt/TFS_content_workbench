'use strict';
// Single Node process, durable local volume. No render work runs in HTTP handlers.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
function createVideoAPI({ dir, userToken, agentToken, leaseMs = 120000 }) {
  if (path.resolve(dir).startsWith(path.resolve(__dirname) + path.sep)) throw Error('VIDEO_DATA_DIR must be outside static root');
  const file = path.join(dir, 'state.json');
  let state;
  const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(state)); fs.renameSync(file + '.tmp', file); };
  const init = () => { if (!state) { fs.mkdirSync(dir, { recursive:true }); state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { assets:[], jobs:[], devices:[] }; } };
  const json = (res, code, value) => { res.writeHead(code, { 'Content-Type':'application/json', 'Cache-Control':'no-store' }); res.end(JSON.stringify(value)); };
  const fail = (code, message) => { throw Object.assign(Error(message), { code }); };
  const auth = (req, token) => { const actual = Buffer.from(req.headers.authorization || ''); const expected = Buffer.from('Bearer ' + token); if (!token) fail(503, '视频制作尚未配置'); if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) fail(401, '制作访问令牌无效'); };
  async function body(req) { let b = ''; for await (const c of req) { b += c; if (Buffer.byteLength(b) > 65536) fail(413, '请求过大'); } try { return JSON.parse(b || '{}'); } catch { fail(400, 'JSON 无效'); } }
  async function upload(req, dest, max) { let size=0; try { await pipeline(req, new Transform({ transform(c,e,cb) { size+=c.length; cb(size > max ? Object.assign(Error('文件过大'), {code:413}) : null,c); } }), fs.createWriteStream(dest, {flags:'wx'})); } catch(e) { fs.rmSync(dest,{force:true}); throw e; } if (!size) { fs.rmSync(dest); fail(400,'文件为空'); } return size; }
  function expire() { let changed=false; for (const j of state.jobs) if (j.status === 'rendering' && j.lease_until < Date.now()) { j.status='failed'; j.error='执行器超时，请重试'; delete j.claim; changed=true; } if(changed) save(); }
  return async (req,res,url) => {
    if (!url.pathname.startsWith('/api/video/')) return false;
    try {
      const p=url.pathname.slice('/api/video/'.length), agent=p.startsWith('agent/');
      auth(req, agent ? agentToken : userToken); init(); expire();
      if(p === 'assets' && req.method === 'POST') {
        const ext=path.extname(url.searchParams.get('name') || '').toLowerCase();
        if(!['.jpg','.jpeg','.png','.webp','.mp4','.mov','.m4v'].includes(ext)) fail(400,'只支持照片和视频');
        const a={id:crypto.randomUUID(), name:(url.searchParams.get('name') || '').slice(0,200), type:['.mp4','.mov','.m4v'].includes(ext)?'video':'image', ext};
        a.size=await upload(req,path.join(dir,a.id+ext),100*1024*1024); state.assets.push(a); save(); return json(res,201,a),true;
      }
      if(p === 'jobs' && req.method === 'GET') return json(res,200,state.jobs.map(({claim,...j})=>j)),true;
      if(p === 'jobs' && req.method === 'POST') {
        const b=await body(req);
        if(!Array.isArray(b.asset_ids) || !b.asset_ids.length || b.asset_ids.length>30 || new Set(b.asset_ids).size!==b.asset_ids.length || b.asset_ids.some(id=>!state.assets.some(a=>a.id===id))) fail(400,'请选择 1–30 个不同素材');
        if(![12,20,30].includes(b.duration) || typeof b.request_id!=='string' || b.request_id.length>100 || !b.request_id) fail(400,'时长或提交标识无效');
        const old=state.jobs.find(j=>j.request_id===b.request_id); if(old) { const {claim,...safe}=old; return json(res,200,safe),true; }
        const j={id:crypto.randomUUID(),content_id:String(b.content_id || crypto.randomUUID()).slice(0,100),script_id:b.script_id || null,title:String(b.title || '美甲作品').slice(0,200),account:String(b.account || '').slice(0,100),assets:b.asset_ids.map(id=>state.assets.find(a=>a.id===id)),duration:b.duration,status:'queued',request_id:b.request_id,created_at:new Date().toISOString(),attempts:0};
        state.jobs.push(j); save(); return json(res,201,j),true;
      }
      const retry=p.match(/^jobs\/([\w-]+)\/retry$/);
      if(retry && req.method==='POST') { const j=state.jobs.find(j=>j.id===retry[1]); if(!j) fail(404,'任务不存在'); if(j.status!=='failed') fail(409,'只能重试失败任务'); j.status='queued'; j.error=''; save(); return json(res,200,{ok:true}),true; }
      const output=p.match(/^jobs\/([\w-]+)\/output$/);
      const asset=p.match(/^agent\/assets\/([\w-]+)$/);
      if(req.method==='GET' && (output || asset)) {
        const j=output && state.jobs.find(j=>j.id===output[1] && j.status==='review');
        const a=asset && state.assets.find(a=>a.id===asset[1]); if(!j && !a) fail(404,'文件不存在');
        const f=path.join(dir,j ? j.id+'.mp4' : a.id+a.ext); const size=fs.statSync(f).size;
        res.writeHead(200,{'Content-Type':j?'video/mp4':'application/octet-stream','Content-Length':size,'Cache-Control':'no-store'}); fs.createReadStream(f).pipe(res); return true;
      }
      if(p==='agent/register' && req.method==='POST') { const b=await body(req); if(typeof b.device_id!=='string' || !/^[\w-]{1,80}$/.test(b.device_id)) fail(400,'设备标识无效'); const d={id:b.device_id,last_seen:Date.now(),ffmpeg:!!b.ffmpeg}; state.devices=state.devices.filter(x=>x.id!==d.id).concat(d); save(); return json(res,200,d),true; }
      if(p==='agent/claim' && req.method==='POST') {
        const b=await body(req); const d=state.devices.find(d=>d.id===b.device_id && d.ffmpeg); if(!d) fail(400,'请先注册可用执行器'); d.last_seen=Date.now();
        if(state.jobs.some(j=>j.device_id===d.id && j.status==='rendering')) return json(res,200,null),true;
        const j=state.jobs.find(j=>j.status==='queued'); if(j) { Object.assign(j,{status:'rendering',device_id:d.id,claim:crypto.randomUUID(),lease_until:Date.now()+leaseMs,attempts:j.attempts+1}); } save(); return json(res,200,j || null),true;
      }
      const action=p.match(/^agent\/jobs\/([\w-]+)\/(heartbeat|complete|fail)$/);
      if(action && req.method==='POST') {
        const j=state.jobs.find(j=>j.id===action[1]); if(!j) fail(404,'任务不存在');
        if(j.status!=='rendering' || req.headers['x-job-claim']!==j.claim) fail(409,'任务租约已失效');
        if(action[2]==='complete') { const dest=path.join(dir,j.id+'.'+j.claim+'.upload'); await upload(req,dest,200*1024*1024); if(j.status!=='rendering' || req.headers['x-job-claim']!==j.claim || j.lease_until<Date.now()) { fs.rmSync(dest,{force:true}); fail(409,'任务租约已失效'); } fs.renameSync(dest,path.join(dir,j.id+'.mp4')); j.status='review'; }
        else if(action[2]==='fail') { const b=await body(req); j.status='failed'; j.error=String(b.error || '渲染失败').slice(0,1000); }
        else { const b=await body(req); if(b.timeline && b.timeline.version===1 && Array.isArray(b.timeline.clips)) j.timeline=b.timeline; j.lease_until=Date.now()+leaseMs; }
        save(); return json(res,200,{ok:true}),true;
      }
      fail(404,'接口不存在');
    } catch(e) { if(!res.headersSent) json(res,Number.isInteger(e.code)?e.code:500,{error:Number.isInteger(e.code)?e.message:'视频服务内部错误'}); else res.destroy(); }
    return true;
  };
}
module.exports={createVideoAPI};
