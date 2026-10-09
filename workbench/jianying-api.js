'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {pipeline} = require('node:stream/promises');
const {Transform} = require('node:stream');
const WEB_ORIGIN = 'https://nail-content-workbench.app.workbuddy.host';

function createJianyingAPI({dir, userToken, workerToken, local = false, leaseMs = 120000}) {
  dir = path.resolve(dir);
  if (dir === __dirname || dir.startsWith(__dirname + path.sep)) throw Error('草稿数据不能位于静态目录内');
  let state;
  const stateFile = path.join(dir, 'state.json');
  const init = () => {
    if (state) return;
    fs.mkdirSync(dir, {recursive:true, mode:0o700});
    state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {assets:[], jobs:[], device:null};
  };
  const save = () => {
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state), {mode:0o600});
    fs.renameSync(stateFile + '.tmp', stateFile);
  };
  const fail = (status, message) => {throw Object.assign(Error(message), {status});};
  const send = (res, status, data) => {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
    res.end(JSON.stringify(data));
  };
  const safeJob = ({claim, ...job}) => job;
  const authorize = (req, token) => {
    if (!token) fail(503, '请先启动 Mac 剪映连接器');
    const a = Buffer.from(req.headers.authorization || '');
    const b = Buffer.from('Bearer ' + token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) fail(401, '请重新连接 Mac');
  };
  async function json(req) {
    const chunks=[]; let size=0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 128*1024) fail(413, '脚本或参数过大');
      chunks.push(chunk);
    }
    try {return JSON.parse(Buffer.concat(chunks).toString() || '{}');}
    catch {fail(400, '参数不是有效 JSON');}
  }
  async function upload(req, destination) {
    let size=0;
    try {
      await pipeline(req, new Transform({transform(chunk, encoding, callback) {
        size += chunk.length;
        callback(size > 100*1024*1024 ? Object.assign(Error('单个文件最大 100MB'), {status:413}) : null, chunk);
      }}), fs.createWriteStream(destination, {flags:'wx', mode:0o600}));
      if (!size) fail(400, '文件为空');
    } catch (error) {fs.rmSync(destination, {force:true}); throw error;}
    return size;
  }
  return async (req,res,url) => {
    if (!url.pathname.startsWith('/api/jianying/')) return false;
    try {
      const route = url.pathname.slice('/api/jianying/'.length);
      const origin = req.headers.origin;
      const localOrigin = 'http://' + req.headers.host;
      const knownOrigin = origin === WEB_ORIGIN || (['localhost','127.0.0.1'].includes(urlHost(req)) && origin === localOrigin);
      if (origin && !knownOrigin) fail(403, '不允许此网页连接剪映');
      if (origin && knownOrigin && local) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary','Origin');
        res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Jianying-Studio, X-Job-Claim');
        res.setHeader('Access-Control-Allow-Private-Network','true');
      }
      if (req.method === 'OPTIONS') {res.writeHead(204);res.end();return true;}
      if (route === 'session' && req.method === 'GET') {
        if (!local || !['localhost','127.0.0.1'].includes(urlHost(req)) || req.headers['x-jianying-studio'] !== '1') fail(403,'仅限本机剪映连接器');
        if (!userToken) fail(503, '剪映连接器未配置');
        send(res,200,{token:userToken});return true;
      }
      const worker = route.startsWith('worker/');
      authorize(req, worker ? workerToken : userToken);
      init();
      for (const job of state.jobs) {
        if (job.status === 'building' && job.lease_until < Date.now()) {
          job.status='failed';job.error='Mac 连接中断，请重试';delete job.claim;save();
        }
      }
      if (route === 'status' && req.method === 'GET') {
        send(res,200,{device:state.device, online:!!state.device && Date.now()-state.device.last_seen < 30000});return true;
      }
      if (route === 'assets' && req.method === 'POST') {
        const name=String(url.searchParams.get('name') || '').slice(0,200);
        const ext=path.extname(name).toLowerCase();
        if (!['.jpg','.jpeg','.png','.webp','.mp4','.mov','.m4v'].includes(ext)) fail(400,'请上传照片或视频');
        const asset={id:crypto.randomUUID(), name, ext, type:['.mp4','.mov','.m4v'].includes(ext)?'video':'image'};
        asset.size=await upload(req,path.join(dir,asset.id+ext));
        state.assets.push(asset);save();send(res,201,asset);return true;
      }
      if (route === 'jobs' && req.method === 'GET') {send(res,200,state.jobs.map(safeJob));return true;}
      if (route === 'jobs' && req.method === 'POST') {
        const b=await json(req);
        if (!Array.isArray(b.asset_ids) || !b.asset_ids.length || b.asset_ids.length>30 || new Set(b.asset_ids).size!==b.asset_ids.length || b.asset_ids.some(id=>!state.assets.some(a=>a.id===id))) fail(400,'请选择 1–30 个不同的素材');
        if (![12,20,30].includes(b.duration) || typeof b.request_id!=='string' || !b.request_id || b.request_id.length>100) fail(400,'时长或提交标识无效');
        const old=state.jobs.find(j=>j.request_id===b.request_id);
        if (old) {send(res,200,safeJob(old));return true;}
        const job={id:crypto.randomUUID(), request_id:b.request_id, title:String(b.title || '第五季作品').slice(0,150),
          content_id:String(b.content_id || crypto.randomUUID()).slice(0,100),script_id:b.script_id || null,
          account:String(b.account || '').slice(0,100),script:String(b.script || '').slice(0,30000),
          instructions:String(b.instructions || '').slice(0,4000),captions:String(b.captions || '').slice(0,2000),
          assets:b.asset_ids.map(id=>state.assets.find(a=>a.id===id)),duration:b.duration,
          status:'queued',created_at:new Date().toISOString(),attempts:0};
        state.jobs.push(job);save();send(res,201,safeJob(job));return true;
      }
      const retry=route.match(/^jobs\/([\w-]+)\/retry$/);
      if (retry && req.method==='POST') {
        const job=state.jobs.find(j=>j.id===retry[1]);
        if (!job) fail(404,'任务不存在');
        if (job.status!=='failed') fail(409,'只有失败任务可以重试');
        job.status='queued';job.error='';save();send(res,200,{ok:true});return true;
      }
      const final=route.match(/^jobs\/([\w-]+)\/final$/);
      if (final) {
        const job=state.jobs.find(j=>j.id===final[1]);
        if (!job) fail(404,'任务不存在');
        if (req.method==='POST') {
          if (!['draft_ready','finished'].includes(job.status)) fail(409,'请先生成剪映工程');
          const tmp=path.join(dir,crypto.randomUUID()+'.upload');
          await upload(req,tmp);
          const fd=fs.openSync(tmp,'r');const header=Buffer.alloc(12);
          try {fs.readSync(fd,header,0,12,0);} finally {fs.closeSync(fd);}
          if (header.toString('ascii',4,8)!=='ftyp') {fs.rmSync(tmp,{force:true});fail(400,'请上传剪映导出的 MP4 文件');}
          fs.renameSync(tmp,path.join(dir,job.id+'.mp4'));
          job.status='finished';save();send(res,200,{ok:true});return true;
        }
        if (req.method==='GET' && job.status==='finished') {
          const f=path.join(dir,job.id+'.mp4');res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':fs.statSync(f).size});fs.createReadStream(f).pipe(res);return true;
        }
        fail(404,'尚未上传成片');
      }
      if (route==='worker/claim' && req.method==='POST') {
        const b=await json(req);
        state.device={skill_version:String(b.skill_version || ''),ready:!!b.ready,last_seen:Date.now(),error:String(b.error || '').slice(0,500)};
        const active=state.jobs.some(j=>j.status==='building');
        const job=state.device.ready && !active ? state.jobs.find(j=>j.status==='queued') : null;
        if (job) Object.assign(job,{status:'building',claim:crypto.randomUUID(),lease_until:Date.now()+leaseMs,attempts:job.attempts+1});
        save();send(res,200,job ? {...job,assets:job.assets.map(a=>({...a,path:path.join(dir,a.id+a.ext)}))} : null);return true;
      }
      const update=route.match(/^worker\/jobs\/([\w-]+)\/(heartbeat|complete|fail)$/);
      if (update && req.method==='POST') {
        const job=state.jobs.find(j=>j.id===update[1]);
        if (!job || job.status!=='building' || req.headers['x-job-claim']!==job.claim) fail(409,'任务领取凭据已失效');
        const b=await json(req);
        if (job.status!=='building' || req.headers['x-job-claim']!==job.claim || job.lease_until < Date.now()) fail(409,'任务领取凭据已失效');
        if (state.device) state.device.last_seen=Date.now();
        if (update[2]==='heartbeat') job.lease_until=Date.now()+leaseMs;
        if (update[2]==='fail') {job.status='failed';job.error=String(b.error || '剪映工程生成失败').slice(0,1000);}
        if (update[2]==='complete') {
          if (typeof b.draft_path!=='string' || !b.draft_path || !Array.isArray(b.clips) || b.clips.length!==job.assets.length) fail(400,'工程回报不完整');
          Object.assign(job,{status:'draft_ready',draft_path:b.draft_path,draft_name:String(b.draft_name || ''),clips:b.clips,skill_version:String(b.skill_version || ''),opened_in_jianying:false});
        }
        save();send(res,200,{ok:true});return true;
      }
      fail(404,'接口不存在');
    } catch(error) {
      if (!res.headersSent) send(res,error.status || 500,{error:error.status ? error.message : '剪映连接器内部错误'});
      else res.destroy();
    }
    return true;
  };
}
function urlHost(req) {return String(req.headers.host || '').split(':')[0];}
module.exports={createJianyingAPI};
