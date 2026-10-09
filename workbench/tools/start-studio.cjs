#!/usr/bin/env node
'use strict';
// Local-only supervisor. Secrets stay in memory; the data survives restarts.
const {spawn, spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const port=process.env.PORT || '4191';
const locate=(name)=>process.env[name.toUpperCase()] || spawnSync('which',[name],{encoding:'utf8'}).stdout.trim();
const ffmpeg=locate('ffmpeg'), ffprobe=locate('ffprobe');
if(!ffmpeg || !ffprobe) {console.error('请先安装 FFmpeg 和 FFprobe：brew install ffmpeg');process.exit(1);}
const env={...process.env,PORT:port,HOST:'127.0.0.1',VIDEO_LOCAL:'1',VIDEO_USER_TOKEN:crypto.randomBytes(32).toString('hex'),VIDEO_AGENT_TOKEN:crypto.randomBytes(32).toString('hex'),VIDEO_DATA_DIR:process.env.VIDEO_DATA_DIR || path.resolve(root,'../.video-data'),FFMPEG:ffmpeg,FFPROBE:ffprobe};
fs.mkdirSync(env.VIDEO_DATA_DIR,{recursive:true,mode:0o700});
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(code),1500).unref();}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
const server=spawn(process.execPath,[path.join(root,'server.js')],{env,stdio:'inherit'});children.push(server);
server.on('exit',code=>stop(code || 0));
const url='http://127.0.0.1:'+port;
(async()=>{
  let ready=false;
  for(let i=0;i<50 && !stopping;i++) {try {const r=await fetch(url+'/api/video/local-session',{headers:{'X-Local-Studio':'1'}});const b=await r.json();if(b.token===env.VIDEO_USER_TOKEN){ready=true;break;}if(r.ok)throw Error('端口已被其他服务占用');}catch(e){if(e.message.includes('占用')){console.error(e.message);return stop(1);}}await new Promise(r=>setTimeout(r,200));}
  if(!ready || stopping){console.error('制作服务启动失败');return stop(1);}
  const worker=spawn(process.env.PYTHON || 'python3',[path.join(__dirname,'local-render-agent.py'),'--url',url,'--device-id','mac-local'],{env,stdio:'inherit'});children.push(worker);
  worker.on('error',e=>{console.error(e.message);stop(1);});worker.on('exit',code=>{if(!stopping){console.error('执行器退出');stop(code || 1);}});
  console.log('\n视频制作已就绪：'+url+'/#studio\n素材和任务保存在 '+env.VIDEO_DATA_DIR+'\n保持此终端运行，Ctrl+C 停止。');
})().catch(e=>{console.error(e);stop(1);});
