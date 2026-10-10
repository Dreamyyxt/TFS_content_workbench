'use strict';
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {pipeline}=require('node:stream/promises');const {Readable,Transform}=require('node:stream');
const BASE='https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_MODEL='doubao-seedance-2-0-260128';
function buildGenerationPrompt(job){
  return '根据以下已确认的拍摄脚本创作竖屏视频。遵循镜头顺序、主体和画面要求。\n标题：'+job.title+'\n拍摄脚本：\n'+job.script+'\n补充要求：\n'+job.instructions+(job.captions?'\n画面文字要求：\n'+job.captions:'');
}
function createVolcClient({keyFile=path.join(os.homedir(),'.workbuddy/volc_mediakit.key'),fetchImpl=fetch,runtimeKey=''}={}) {
  /* 密钥来源优先级：页面粘贴（runtimeKey，不落盘）> 环境变量 ARK_API_KEY > 本机 key 文件。
     页面来源是为「换电脑不必再手动放 key 文件」而加：在页面「密钥」里粘贴一次，
     存进当前浏览器，之后每个请求随 X-Ark-Key 头带过来，服务端只用于本次调用。 */
  let override=String(runtimeKey || '').trim();
  const keyFileHas=()=>fs.existsSync(keyFile) && String(fs.readFileSync(keyFile,'utf8')).trim()!=='';
  const keySource=()=>override ? 'page' : (String(process.env.ARK_API_KEY || '').trim() ? 'env' : (keyFileHas() ? 'file' : 'none'));
  const key=()=>{
    const value=(override || process.env.ARK_API_KEY || (fs.existsSync(keyFile)?fs.readFileSync(keyFile,'utf8'):'')).trim();
    if(!value)throw Error('未配置火山方舟密钥：请在页面「🔑 密钥」中粘贴火山方舟 API Key，或配置 ~/.workbuddy/volc_mediakit.key');
    return value;
  };
  async function request(route,body) {
    const secret=key();let response;
    try{response=await fetchImpl(BASE+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});}
    catch {throw Object.assign(Error(body?'火山提交结果未知，请先到方舟控制台核对任务，避免重复计费。':'暂时无法查询火山任务，请稍后继续查询。'),{uncertain:!!body,transient:!body});}
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data.error){
      const code=String(data.error?.code || response.status);
      let detail=String(data.error?.message || '请求失败').replaceAll(secret,'[已隐藏]').replace(/ark-[\w-]+/g,'[已隐藏]');
      if(/has not activated|model.*not.*enabled/i.test(detail))detail='尚未开通所选火山视频模型，请在方舟控制台开通后重试，或选择已开通的模型。';
      if(response.status===401)detail='火山方舟密钥无效，请在页面「🔑 密钥」中更新后重试。';
      if(response.status===403)detail='火山模型未开通、余额或权限不足，请在方舟控制台检查：'+code;
      throw Object.assign(Error(detail.slice(0,500)),{transient:response.status===429 || response.status>=500,uncertain:!!body && response.status>=500});
    }
    return data;
  }
  return {
    /* 页面粘贴的密钥（每次带 X-Ark-Key 头进来时更新）；传空串则回退到环境变量 / key 文件 */
    setKey(value){ override=String(value==null?'':value).trim(); },
    hasKey(){ try{ key(); return true; }catch{ return false; } },
    keySource,
    async capabilities(){try{const data=await request('/models');return {ready:true,model:DEFAULT_MODEL,source:keySource(),models:(data.data || []).filter(m=>/seedance-2-/.test(m.id)).map(m=>m.id)};}catch(e){return {ready:false,error:e.message,model:DEFAULT_MODEL,source:keySource()};}},
    async submit(job,dir){
      const prompt=job.submitted_prompt || buildGenerationPrompt(job);
      const content=[{type:'text',text:prompt}];
      for(const asset of job.assets){
        if(asset.type!=='image')throw Error('AI 生成的本地参考素材请使用照片；视频参考请填写公网视频链接。');
        const mime=asset.ext==='.jpg'||asset.ext==='.jpeg'?'jpeg':asset.ext.slice(1);
        content.push({type:'image_url',image_url:{url:'data:image/'+mime+';base64,'+fs.readFileSync(path.join(dir,asset.id+asset.ext)).toString('base64')},role:'reference_image'});
      }
      for(const url of job.reference_videos || [])content.push({type:'video_url',video_url:{url},role:'reference_video'});
      const data=await request('/contents/generations/tasks',{model:job.model || DEFAULT_MODEL,content,ratio:'9:16',duration:job.duration,resolution:'720p',generate_audio:true,watermark:false});
      if(!data.id)throw Object.assign(Error('火山未返回任务 ID，请在控制台核对后再提交。'),{uncertain:true});
      return data.id;
    },
    get: id=>request('/contents/generations/tasks/'+encodeURIComponent(id)),
    async download(url,destination){
      const u=new URL(url);
      if(u.protocol!=='https:' || !['volces.com','volcengine.com','byteimg.com'].some(host=>u.hostname.endsWith('.'+host)))throw Error('火山返回的视频地址不是受支持的官方文件域名');
      const response=await fetchImpl(url,{signal:AbortSignal.timeout(120000),redirect:'error'});
      if(!response.ok || !response.body)throw Error('成片下载失败，请稍后重试下载');
      const tmp=destination+'.tmp';let size=0;
      try{
        await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,cb){size+=chunk.length;cb(size>100*1024*1024?Error('成片超过100MB'):null,chunk);}}),fs.createWriteStream(tmp,{mode:0o600}));
        const fd=fs.openSync(tmp,'r'),header=Buffer.alloc(12);try{fs.readSync(fd,header,0,12,0);}finally{fs.closeSync(fd);}
        if(header.toString('ascii',4,8)!=='ftyp')throw Error('火山返回的文件不是可识别的 MP4');
        fs.renameSync(tmp,destination);
      }catch(e){fs.rmSync(tmp,{force:true});throw e;}
    }
  };
}
module.exports={createVolcClient,DEFAULT_MODEL,buildGenerationPrompt};
